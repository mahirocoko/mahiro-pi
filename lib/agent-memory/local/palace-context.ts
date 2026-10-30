// Fixed session-context metadata for the Palace Context view.
// This is not the synthetic PalaceSnapshot ABI and it is not corpus paging.
// It stores no prompt text, message bodies, memory bodies, tool schemas, paths, or provider payloads.

const tokenLimit = 10_000_000
const capturedAtPattern =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/
const sourcePattern = /^[A-Za-z0-9._:-]{1,64}$/
const providerPattern = /^[A-Za-z0-9._:-]{1,40}$/
const modelIdPattern = /^(?!\/)(?!.*\.\.)(?!.*:\/\/)[A-Za-z0-9._:/-]{1,80}$/

export const palaceContextCaptures = ['command-invocation', 'preview-fixture'] as const
export const palaceContextQualities = ['estimated', 'owner-supplied'] as const
export const palaceContextBreakdownKeys = [
  'system',
  'core',
  'external',
  'summary',
  'tools',
  'messages',
] as const

export type PalaceContextCapture = (typeof palaceContextCaptures)[number]
export type PalaceContextQuality = (typeof palaceContextQualities)[number]
export type PalaceContextBreakdownKey = (typeof palaceContextBreakdownKeys)[number]

export interface PalaceContextModel {
  provider: string | null
  id: string
}

export interface PalaceContextUsage {
  source: string
  quality: PalaceContextQuality
  usedTokens: number
  contextWindow: number
  percent: number
}

export type PalaceContextBreakdown = Record<PalaceContextBreakdownKey, number> & {
  quality: PalaceContextQuality
}

export interface PalaceContextSnapshot {
  version: 1
  capturedAt: string
  capture: PalaceContextCapture
  model: PalaceContextModel | null
  usage: PalaceContextUsage
  breakdown: PalaceContextBreakdown
}

function refused(): never {
  throw Error('Local memory palace refused')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set<string>([...keys, ...optional])
  const present = Object.keys(value)
  if (present.some((key) => !allowed.has(key))) refused()
  if (keys.some((key) => !Object.hasOwn(value, key))) refused()
}

function boundedInt(value: unknown, max = tokenLimit): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) refused()
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) refused()
  return value as T
}

function boundedText(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) refused()
  return value
}

function usagePercent(used: number, window: number): number {
  return Math.round((used / window) * 100)
}

function freezeSnapshot(snapshot: PalaceContextSnapshot): PalaceContextSnapshot {
  Object.freeze(snapshot.model)
  Object.freeze(snapshot.usage)
  Object.freeze(snapshot.breakdown)
  return Object.freeze(snapshot)
}

export function parsePalaceContext(value: unknown): PalaceContextSnapshot {
  if (!isRecord(value)) refused()
  exactKeys(value, ['version', 'capturedAt', 'capture', 'model', 'usage', 'breakdown'])
  if (value.version !== 1) refused()
  const capturedAt = boundedText(value.capturedAt, capturedAtPattern)
  const capture = oneOf(value.capture, palaceContextCaptures)
  const model = parseModel(value.model)
  const usage = parseUsage(value.usage)
  const breakdown = parseBreakdown(value.breakdown)
  const attributed = palaceContextBreakdownKeys.reduce((sum, key) => sum + breakdown[key], 0)
  if (attributed > usage.usedTokens) refused()
  return freezeSnapshot({ version: 1, capturedAt, capture, model, usage, breakdown })
}

function parseModel(value: unknown): PalaceContextModel | null {
  if (value === null) return null
  if (!isRecord(value)) refused()
  exactKeys(value, ['provider', 'id'])
  const provider = value.provider === null ? null : boundedText(value.provider, providerPattern)
  return { provider, id: boundedText(value.id, modelIdPattern) }
}

function parseUsage(value: unknown): PalaceContextUsage {
  if (!isRecord(value)) refused()
  exactKeys(value, ['source', 'quality', 'usedTokens', 'contextWindow'], ['percent'])
  const usedTokens = boundedInt(value.usedTokens)
  const contextWindow = boundedInt(value.contextWindow)
  if (contextWindow < 1 || usedTokens > contextWindow) refused()
  const percent = usagePercent(usedTokens, contextWindow)
  if (Object.hasOwn(value, 'percent') && value.percent !== percent) refused()
  return {
    source: boundedText(value.source, sourcePattern),
    quality: oneOf(value.quality, palaceContextQualities),
    usedTokens,
    contextWindow,
    percent,
  }
}

function parseBreakdown(value: unknown): PalaceContextBreakdown {
  if (!isRecord(value)) refused()
  exactKeys(value, ['quality', ...palaceContextBreakdownKeys])
  const breakdown = { quality: oneOf(value.quality, palaceContextQualities) } as PalaceContextBreakdown
  for (const key of palaceContextBreakdownKeys) breakdown[key] = boundedInt(value[key])
  return breakdown
}

export function syntheticPalaceContextFixture(): PalaceContextSnapshot {
  return parsePalaceContext({
    version: 1,
    capturedAt: '2026-10-29T15:00:00Z',
    capture: 'preview-fixture',
    model: { provider: null, id: 'preview-fixture' },
    usage: {
      source: 'preview-fixture',
      quality: 'owner-supplied',
      usedTokens: 240,
      contextWindow: 480,
    },
    breakdown: {
      quality: 'owner-supplied',
      system: 20,
      core: 20,
      external: 20,
      summary: 20,
      tools: 20,
      messages: 20,
    },
  })
}
