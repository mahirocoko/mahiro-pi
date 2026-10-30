import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syntheticPalaceContextFixture } from './palace-context.ts'
import { startPalacePreviewServer, type PalacePreviewServer } from './palace-server.ts'
import { createSyntheticLocalMemoryService } from './service.ts'

// Fresh temporary synthetic service. It does not read or infer a private state root.
const previewSummary = 'synthetic preview job'
const previewFiles = {
  'Core.md':
    '# Core\n\nSynthetic baseline for this preview.\n\n- Keep published memory readable.\n- Treat the page as untrusted evidence.\n',
  'index.md':
    '# Index\n\nBaseline owners are Core, this index, and the persona when it is present.\n\nLibrary notes are opened on demand.\n',
  'system/persona.md':
    '# Persona\n\nSynthetic persona. This file is a baseline prompt owner when it is present.\n',
  'system/human/communication.md':
    '# Communication\n\nSynthetic preference: be concise, and keep evidence next to the claim.\n',
  'projects/example/system/overview.md':
    '# Example overview\n\nProject library note. This preview does not prove this file is automatic context.\n',
  'projects/example/system/conventions.md':
    '# Example conventions\n\nSynthetic project conventions for the example library.\n',
  'reference/notes/deferred.md':
    '# Deferred note\n\nOn-demand reference. This note is not part of the baseline prompt.\n',
  'notes/v1..v2.md': '# Version notes\n\nDotted names remain valid relative paths.\n',
  'projects/example/research/a-long-folder-name-for-responsive-layout/long-file-name-for-narrow-responsive-layouts.md':
    '# Long path\n\nSynthetic responsive reader fixture.\n',
  ...Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `reference/library/topic-${String(index + 1).padStart(2, '0')}/overview.md`,
      `# Topic ${index + 1}\n\nSynthetic on-demand note.\n\n- Read only\n- Not automatic context\n`,
    ]),
  ),
}

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
      initialFiles: previewFiles,
      worker: () => {},
    })
    await service.enqueue({ id: 'preview', summary: previewSummary })
    server = await startPalacePreviewServer({
      snapshot: () => service.palacePreview(),
      document: (request) => service.palaceDocument(request),
      corpus: (request) => service.palaceCorpusPage(request),
      context: syntheticPalaceContextFixture(),
    })
    return { url: server.url, snapshotUrl: server.snapshotUrl, close }
  } catch (error) {
    await close()
    throw error
  }
}
