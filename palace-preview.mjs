import { openSyntheticPalacePreview } from './lib/agent-memory/local/preview.ts'

// Explicit synthetic preview. It does not accept a state path or touch a live profile.
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log(
    'Usage: pnpm memory:palace-preview\nStarts a disconnected synthetic Palace HTML preview on 127.0.0.1 and prints its local URL.\nIt creates a fresh temporary service. It does not read a private memory root, install, or change live authority.',
  )
} else if (args.length !== 0) {
  console.error('This preview does not accept a state path.')
  process.exitCode = 1
} else {
  try {
    const preview = await openSyntheticPalacePreview()
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      preview.close().then(
        () => process.exit(0),
        () => process.exit(1),
      )
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    console.log(`Synthetic Palace preview (not live authority)\n${preview.url}\n${preview.snapshotUrl}`)
  } catch {
    console.error('Synthetic Palace preview unavailable')
    process.exitCode = 1
  }
}
