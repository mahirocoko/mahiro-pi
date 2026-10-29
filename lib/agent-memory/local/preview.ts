import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startPalacePreviewServer, type PalacePreviewServer } from './palace-server.ts'
import { createSyntheticLocalMemoryService } from './service.ts'

// Fresh temporary synthetic service. It does not read or infer a private state root.
const previewSummary = 'synthetic preview job'

export async function openSyntheticPalacePreview(): Promise<{
  url: string
  snapshotUrl: string
  close(): Promise<void>
}> {
  const parent = await realpath(tmpdir())
  const dir = await mkdtemp(join(parent, 'mahiro-palace-preview-'))
  let server: PalacePreviewServer | undefined
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (closing) return closing
    closing = (async () => {
      try {
        if (server) await server.close()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })()
    return closing
  }
  try {
    const stateRoot = join(dir, 'state')
    await mkdir(stateRoot, { mode: 0o700 })
    const service = await createSyntheticLocalMemoryService({
      stateRoot,
      initialFiles: {
        'Core.md': 'Synthetic core.\n',
        'index.md': 'Synthetic index.\n',
      },
      worker: () => {},
    })
    await service.enqueue({ id: 'preview', summary: previewSummary })
    server = await startPalacePreviewServer({ snapshot: () => service.palacePreview() })
    return { url: server.url, snapshotUrl: server.snapshotUrl, close }
  } catch (error) {
    await close()
    throw error
  }
}
