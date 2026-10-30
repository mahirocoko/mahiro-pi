import { spawn } from 'node:child_process'
import { LocalGitUncertainty, poisonLocalMemoryClaim } from './coordination.ts'

export { LocalGitUncertainty } from './coordination.ts'

// Internal runner only. Service callers cannot select argv, an executable or a child factory.
// Fixtures exercise this module directly; no process-injection seam reaches the service API.
export async function runLocalGitProcess(input: {
  argv: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  allowedCodes: readonly number[]
  input?: string
  capture?: { maxBytes: number; totalBytes: number }
}): Promise<{ code: number; stdout: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', input.argv, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      stdio: [input.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    let bytes = 0
    let kept = 0
    let diagnostics = 0
    let settled = false
    let uncertain: LocalGitUncertainty | undefined
    let escalation: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error, code = 0) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(escalation)
      clearTimeout(deadline)
      if (error) reject(error)
      else resolve({ code, stdout: Buffer.concat(chunks), truncated: bytes > kept })
    }
    const interrupt = (reason: string) => {
      if (uncertain || settled) return
      uncertain = new LocalGitUncertainty(reason)
      // Poison before any rejection/catch/finally can write or delete evidence.
      poisonLocalMemoryClaim()
      child.kill('SIGTERM')
      escalation = setTimeout(() => child.kill('SIGKILL'), 100)
      // Pipes may belong to descendants. No universal tree settlement is inferred.
      deadline = setTimeout(() => finish(uncertain), 1000)
    }
    const timer = setTimeout(() => interrupt('timeout'), 10000)
    child.stdin?.on('error', () => {}) // EPIPE is settled by child error/close, not an uncaught event.
    if (input.input !== undefined) child.stdin?.end(input.input)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled || uncertain) return
      bytes += chunk.length
      const bound = input.capture?.totalBytes ?? 1024 * 1024
      if (bytes > bound) {
        interrupt('stdout limit')
        return
      }
      const room = (input.capture?.maxBytes ?? bound) - kept
      if (room > 0) {
        const piece = chunk.subarray(0, Math.min(room, chunk.length))
        chunks.push(piece)
        kept += piece.length
      }
      // Prefix capture drains/discards the rest; reaching the prefix never kills Git.
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      diagnostics += chunk.length
      if (diagnostics > 65536) interrupt('stderr limit')
    })
    child.once('error', (error) => finish(uncertain ?? error))
    child.once('close', (code, signal) => {
      if (uncertain) {
        finish(uncertain)
        return
      }
      if (signal || code === null) {
        poisonLocalMemoryClaim()
        finish(new LocalGitUncertainty('unexpected termination'))
      } else if (!input.allowedCodes.includes(code)) finish(Error(`Local Git failed (${code})`))
      else if (input.capture && bytes !== input.capture.totalBytes) finish(Error('Local Git object refused'))
      else finish(undefined, code)
    })
  })
}
