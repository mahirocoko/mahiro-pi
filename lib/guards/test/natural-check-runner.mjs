// Source-check tooling only: never supervise or terminate a suite that may mutate fixtures.
import fs from 'node:fs'
import { spawn } from 'node:child_process'

async function processGroup(pid) {
  if (!pid || process.platform === 'win32') return null
  return new Promise((resolve) => {
    const query = spawn('ps', ['-o', 'pgid=', '-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] })
    let text = ''
    query.stdout?.on('data', (chunk) => {
      if (text.length < 128) text += chunk.toString().slice(0, 128 - text.length)
    })
    query.on('error', () => {})
    query.on('close', (code) => resolve(code === 0 && /^\s*\d+\s*$/.test(text) ? Number(text) : null))
  })
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ logPath: string, env?: NodeJS.ProcessEnv, logBytes?: number, consoleBytes?: number,
 *   stdout?: import('node:stream').Writable, stderr?: import('node:stream').Writable }} options
 */
export async function runNaturalCheck(
  command,
  args,
  {
    logPath,
    env = process.env,
    logBytes = 16 * 1024 * 1024,
    consoleBytes = 1024 * 1024,
    stdout = process.stdout,
    stderr = process.stderr,
  },
) {
  const result = {
    pid: /** @type {number | null} */ (null),
    pgid: /** @type {number | null} */ (null),
    status: /** @type {number | null} */ (null),
    signal: /** @type {NodeJS.Signals | null} */ (null),
    error: '',
    timeoutMs: null,
    externalWait: 'child close and output callbacks settled',
    captureTruncated: false,
    consoleTruncated: false,
    ioErrors: /** @type {string[]} */ ([]),
    bytesDrained: 0,
    logBytesWritten: 0,
    consoleBytesWritten: 0,
    outputDrained: false,
    ok: false,
  }
  let fd
  try {
    fd = fs.openSync(logPath, 'wx', 0o600)
  } catch (error) {
    result.ioErrors.push(`log open: ${error.message}`)
  }
  const pending = []
  const ends = []
  let logFailed = fd === undefined
  const consume = (chunk, output) => {
    result.bytesDrained += chunk.length
    const logPart = chunk.subarray(0, Math.max(0, logBytes - result.logBytesWritten))
    if (logPart.length !== chunk.length) result.captureTruncated = true
    if (!logFailed && logPart.length) {
      try {
        let offset = 0
        while (offset < logPart.length) {
          const written = fs.writeSync(fd, logPart, offset, logPart.length - offset)
          if (!written) throw new Error('zero-byte log write')
          offset += written
          result.logBytesWritten += written
        }
      } catch (error) {
        logFailed = true
        result.ioErrors.push(`log write: ${error.message}`)
      }
    }
    const consolePart = chunk.subarray(0, Math.max(0, consoleBytes - result.consoleBytesWritten))
    if (consolePart.length !== chunk.length) result.consoleTruncated = true
    if (consolePart.length) {
      result.consoleBytesWritten += consolePart.length
      pending.push(
        new Promise((resolve) => {
          try {
            output.write(consolePart, (error) => {
              if (error) result.ioErrors.push(`console write: ${error.message}`)
              resolve()
            })
          } catch (error) {
            result.ioErrors.push(`console write: ${error.message}`)
            resolve()
          }
        }),
      )
    }
  }
  const consoleError = (error) => result.ioErrors.push(`console stream: ${error.message}`)
  stdout.on('error', consoleError)
  stderr.on('error', consoleError)
  let group = Promise.resolve(null)
  try {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    result.pid = child.pid ?? null
    group = processGroup(result.pid)
    for (const [pipe, output] of [
      [child.stdout, stdout],
      [child.stderr, stderr],
    ]) {
      if (!pipe) continue
      const state = { ended: false }
      ends.push(state)
      pipe.on('data', (chunk) => consume(chunk, output))
      pipe.on('end', () => {
        state.ended = true
      })
      pipe.on('error', (error) => result.ioErrors.push(`child pipe: ${error.message}`))
    }
    await new Promise((resolve) => {
      child.on('error', (error) => {
        result.error = String(error)
      })
      child.on('close', (code, signal) => {
        result.status = code
        result.signal = signal
        resolve()
      })
    })
    result.outputDrained = ends.length === 2 && ends.every((state) => state.ended)
  } catch (error) {
    result.error = String(error)
  }
  result.pgid = await group
  await Promise.all(pending)
  stdout.removeListener('error', consoleError)
  stderr.removeListener('error', consoleError)
  if (fd !== undefined) {
    try {
      fs.fsyncSync(fd)
    } catch (error) {
      result.ioErrors.push(`log flush: ${error.message}`)
    }
    try {
      fs.closeSync(fd)
    } catch (error) {
      result.ioErrors.push(`log close: ${error.message}`)
    }
  }
  result.ok =
    result.status === 0 &&
    result.signal === null &&
    !result.error &&
    result.outputDrained &&
    !result.captureTruncated &&
    !result.consoleTruncated &&
    result.ioErrors.length === 0
  return result
}
