import { resolve } from 'node:path'
import { memoryFailureCode } from '../reasons.ts'
import { MemoryDataEngine } from './data.ts'
import { engineEnvironment } from './io.ts'
import {
  encode,
  Frames,
  methods,
  protocolVersion,
  transportLimits,
  validateInput,
  type Checkpoint,
  type Method,
} from './protocol.ts'
import { objectShape } from '../../continuity/records.ts'

const [root, epoch] = process.argv.slice(2)
if (!root || resolve(root) !== root || !epoch || !/^[a-f0-9-]{36}$/.test(epoch))
  throw Error('Private engine bootstrap required')
const engine = new MemoryDataEngine(root, engineEnvironment())
let active: { id: string; abort: AbortController } | undefined
let serial = 0
const checks = new Map<number, { id: string; resolve: () => void; reject: (error: Error) => void }>()
async function send(value: object) {
  const data = encode({ v: protocolVersion, epoch, ...value }, transportLimits.reply)
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(data, (error) => (error ? reject(error) : resolve())),
  )
}
async function checkpoint(id: string, targets: Checkpoint) {
  const check = ++serial
  await new Promise<void>((resolve, reject) => {
    checks.set(check, { id, resolve, reject })
    void send({ id, check, targets }).catch(reject)
  })
}
function cancel(id: string) {
  if (active?.id !== id) return
  active.abort.abort(Error('Engine request cancelled'))
  for (const [key, value] of checks)
    if (value.id === id) {
      value.reject(Error('Engine request cancelled'))
      checks.delete(key)
    }
}
const frames = new Frames(transportLimits.request, (message) => {
  if (
    !objectShape(message, ['v', 'epoch', 'id', 'method', 'input', 'cancel', 'check', 'allow', 'drained']) ||
    message.v !== protocolVersion ||
    message.epoch !== epoch ||
    typeof message.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(message.id)
  )
    throw Error('Invalid engine channel')
  const id = message.id
  if (message.cancel === true && Object.keys(message).length === 4) {
    cancel(id)
    return
  }
  if (
    typeof message.check === 'number' &&
    typeof message.allow === 'boolean' &&
    Object.keys(message).length === 5
  ) {
    const check = checks.get(message.check)
    if (!check || check.id !== id) return // late cancellation reply has no authority
    checks.delete(message.check)
    if (message.allow && !active?.abort.signal.aborted) check.resolve()
    else check.reject(Error('Live parent authority unavailable'))
    return
  }
  const observation = ['reconcile', 'recover'].includes(message.method as string)
  if (
    Object.keys(message).length !== (observation ? 6 : 5) ||
    (observation && typeof message.drained !== 'boolean') ||
    !methods.includes(message.method as Method) ||
    active
  )
    throw Error('Invalid or concurrent engine request')
  const method = message.method as Method
  validateInput(method, message.input)
  const abort = new AbortController()
  active = { id, abort }
  void (async () => {
    try {
      const result = await engine.execute(
        method,
        message.input as never,
        (targets) => checkpoint(id, targets),
        abort.signal,
        observation && message.drained === true,
      )
      abort.signal.throwIfAborted()
      await send({ id, result })
    } catch (error) {
      // No raw text, paths, headings, causes or Git output cross the channel.
      await send({ id, error: memoryFailureCode(error) })
    } finally {
      active = undefined
    }
  })().catch(() => {
    process.exitCode = 1
    process.stdin.destroy()
    process.stdout.end()
  })
})
process.stdin.on('data', (chunk: Buffer) => {
  try {
    frames.push(chunk)
  } catch {
    if (active) cancel(active.id)
    process.exitCode = 1
    process.stdin.destroy()
    process.stdout.end()
  }
})
process.stdin.on('end', () => {
  if (active) cancel(active.id)
  process.stdout.end()
})
process.stdin.on('error', () => {
  if (active) cancel(active.id)
  process.exitCode = 1
})
