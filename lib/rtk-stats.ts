// Explicit upstream CLI readouts only. Mahiro never opens the DB. Upstream may initialize it.
// No shell, polling or provider accounting; telemetry disabled per statistics child.
import { execFile } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'

export type RTKScope = 'project' | 'all'
export type RTKView = 'overview' | 'daily' | 'commands'
export const RTK_STATS_BOUNDS = Object.freeze({
  jsonBytes: 131072,
  reportBytes: 262144,
  timeoutMs: 3000,
  concurrent: 2,
})
export const RTK_STATS_SOURCE =
  'RTK CLI tracking; includes other RTK clients, not this Pi session. Output-token estimates (bytes/4), not provider input/output, billed tokens or dollars.'
export type RTKSummary = {
  total_commands: number
  total_input: number
  total_output: number
  total_saved: number
  avg_savings_pct: number
  total_time_ms: number
  avg_time_ms: number
  oversized_excluded: number
}
export type RTKDay = {
  date: string
  commands: number
  input_tokens: number
  output_tokens: number
  saved_tokens: number
  savings_pct: number
  total_time_ms: number
  avg_time_ms: number
}
export type RTKSnapshot = { summary: RTKSummary; daily: RTKDay[] }
export type RTKStatsResult = {
  scope: RTKScope
  view: RTKView
  source: string
  fetchedAt: string
} & (
  | { status: 'ok'; snapshot: RTKSnapshot; report?: never }
  | { status: 'ok'; report: string; snapshot?: never }
  | { status: 'missing-binary' | 'timeout' | 'oversize' | 'malformed' | 'busy' | 'unavailable' | 'cancelled' }
)

export function rtkStatsArgs(scope: RTKScope, view: RTKView): string[] {
  if (!['project', 'all'].includes(scope) || !['overview', 'daily', 'commands'].includes(view))
    throw Error('Invalid RTK statistics scope/view')
  return [
    'gain',
    ...(view === 'commands' ? [] : ['--daily', '--format', 'json']),
    '--text',
    ...(scope === 'project' ? ['-p'] : []),
  ]
}

export function sanitizeRTKReport(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
}

function numbers<T extends string>(value: unknown, keys: readonly T[]): Record<T, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid statistics')
  const out = {} as Record<T, number>
  for (const key of keys) {
    const n = (value as Record<string, unknown>)[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER)
      throw Error('Invalid statistics')
    out[key] = n
  }
  return out
}
export function parseRTKStats(bytes: Uint8Array): RTKSnapshot {
  if (bytes.byteLength > RTK_STATS_BOUNDS.jsonBytes) throw Error('Oversize statistics')
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const summary = numbers(data?.summary, [
    'total_commands',
    'total_input',
    'total_output',
    'total_saved',
    'avg_savings_pct',
    'total_time_ms',
    'avg_time_ms',
    'oversized_excluded',
  ] as const)
  if (!Array.isArray(data?.daily)) throw Error('Invalid daily statistics')
  const daily: RTKDay[] = data.daily.map((row: any) => {
    const date = row?.date
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw Error('Invalid statistics date')
    return {
      date,
      ...numbers(row, [
        'commands',
        'input_tokens',
        'output_tokens',
        'saved_tokens',
        'savings_pct',
        'total_time_ms',
        'avg_time_ms',
      ] as const),
    }
  })
  return { summary, daily }
}

let inFlight = 0
export async function readRTKStats(
  scope: RTKScope,
  view: RTKView,
  ctx: { cwd: string; signal?: AbortSignal },
): Promise<RTKStatsResult> {
  const args = rtkStatsArgs(scope, view)
  const result = (value: any): RTKStatsResult => ({
    scope,
    view,
    source: RTK_STATS_SOURCE,
    fetchedAt: new Date().toISOString(),
    ...value,
  })
  if (ctx.signal?.aborted) return result({ status: 'cancelled' })
  if (inFlight >= RTK_STATS_BOUNDS.concurrent) return result({ status: 'busy' })
  inFlight++
  return new Promise((resolve) => {
    const finish = (error: any, stdout?: Buffer) => {
      inFlight--
      if (ctx.signal?.aborted) return resolve(result({ status: 'cancelled' }))
      if (error)
        return resolve(
          result({
            status:
              error.code === 'ENOENT'
                ? 'missing-binary'
                : error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                  ? 'oversize'
                  : error.killed
                    ? 'timeout'
                    : 'unavailable',
          }),
        )
      try {
        if (!stdout) throw Error('Empty statistics')
        if (view !== 'commands') return resolve(result({ status: 'ok', snapshot: parseRTKStats(stdout) }))
        const report = sanitizeRTKReport(new TextDecoder('utf-8', { fatal: true }).decode(stdout))
        if (!report.trim()) throw Error('Empty report')
        resolve(result({ status: 'ok', report }))
      } catch {
        resolve(result({ status: 'malformed' }))
      }
    }
    try {
      execFile(
        'rtk',
        args,
        {
          cwd: ctx.cwd,
          env: { ...process.env, RTK_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
          signal: ctx.signal,
          timeout: RTK_STATS_BOUNDS.timeoutMs,
          maxBuffer: view === 'commands' ? RTK_STATS_BOUNDS.reportBytes : RTK_STATS_BOUNDS.jsonBytes,
          encoding: 'buffer',
          shell: false,
          windowsHide: true,
          killSignal: 'SIGKILL',
        },
        finish,
      )
    } catch (error) {
      finish(error)
    }
  })
}
