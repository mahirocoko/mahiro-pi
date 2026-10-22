import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Runner = (file: string, args: string[], signal: AbortSignal) => Promise<void>

export const runAudio: Runner = (file, args, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        signal,
        timeout: 10_000,
        killSignal: 'SIGKILL',
        maxBuffer: 4096,
        windowsHide: true,
      },
      (error) => (error ? reject(error) : resolve()),
    )
  })

export function createVoice({
  runner = runAudio,
  platform = process.platform,
  now = Date.now,
  makeDirectory = () => mkdtemp(join(tmpdir(), 'mahiro-pi-voice-')),
  removeDirectory = (directory: string) => rm(directory, { recursive: true, force: true }),
  isCurrent = (): boolean => true,
  deadline = 20_000,
} = {}) {
  let active: AbortController | undefined
  let disposed = false
  let lastStarted = -Infinity
  const allowed = () => !disposed && isCurrent()
  return {
    async play() {
      if (!allowed() || platform !== 'darwin' || active || now() - lastStarted < 3000) return
      lastStarted = now()
      const controller = new AbortController()
      active = controller
      let directory: string | undefined
      const timer = setTimeout(() => controller.abort(), deadline)
      timer.unref?.()
      try {
        directory = await makeDirectory()
        const audio = join(directory, 'speech.aiff')
        if (!allowed() || controller.signal.aborted) return
        await runner(
          '/usr/bin/say',
          ['-v', 'Kanya', '-r', '300', 'ทำงานเสร็จแล้วค่ะ', '-o', audio],
          controller.signal,
        )
        if (allowed() && !controller.signal.aborted) {
          await runner('/usr/bin/afplay', ['-v', '0.4', audio], controller.signal)
        }
      } catch {
        // Optional notification failures must never fail or delay Pi completion.
      } finally {
        clearTimeout(timer)
        if (directory) await removeDirectory(directory).catch(() => {})
        if (active === controller) active = undefined
      }
    },
    dispose() {
      disposed = true
      active?.abort()
    },
  }
}

// Separate from footer ownership; headless instances must not touch this slot.
const ownerKey = Symbol.for('mahiro-pi.finish-voice.owner')
type Owner = { generation: symbol; dispose: () => void }
export function voiceOwner(): { current?: Owner } {
  const root = globalThis as typeof globalThis & {
    [ownerKey]?: { current?: Owner }
  }
  return (root[ownerKey] ??= {})
}
