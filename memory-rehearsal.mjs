import { runMemoryRehearsal } from './lib/agent-memory/local/rehearsal.ts'

// Standalone, disconnected fixed-synthetic operator. No installed authority wiring.
const args = process.argv.slice(2)
const command = args.shift()
const mutation = command === 'apply' || command === 'rollback'
const flags = new Map()
let valid = ['preview', 'apply', 'status', 'rollback'].includes(command)
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index]
  const value = args[index + 1]
  if (
    !['--target', '--fixture', ...(mutation ? ['--operation', '--expect'] : [])].includes(flag) ||
    flags.has(flag) ||
    typeof value !== 'string' ||
    value.startsWith('--')
  ) {
    valid = false
    break
  }
  flags.set(flag, value)
}
if (
  flags.size !== (mutation ? 4 : 2) ||
  flags.get('--fixture') !== 'r6-basic-v1' ||
  (mutation &&
    (!/^[a-f0-9]{32}$/.test(flags.get('--operation') ?? '') ||
      !/^[a-f0-9]{64}$/.test(flags.get('--expect') ?? '')))
)
  valid = false

if (!valid) {
  console.error(
    'Usage: node memory-rehearsal.mjs preview|apply|status|rollback --target /canonical/mahiro-memory-rehearsal-<16 lowercase hex>/shadow --fixture r6-basic-v1 [--operation <32 hex> --expect <64 hex> (apply/rollback only)]',
  )
  process.exitCode = 2
} else {
  const result = await runMemoryRehearsal({
    command,
    target: flags.get('--target'),
    fixture: 'r6-basic-v1',
    ...(mutation ? { operation: flags.get('--operation'), expect: flags.get('--expect') } : {}),
  })
  console.log(JSON.stringify({ scope: 'fixed-synthetic-disconnected', ...result }))
  if (result.disposition === 'refused' || result.disposition === 'unknown') process.exitCode = 1
}
