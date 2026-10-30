import { once } from 'node:events'
import { createSyntheticLocalMemoryService } from '../../lib/agent-memory/local/service.ts'
import { withLocalMemoryClaim } from '../../lib/agent-memory/local/coordination.ts'
import { rollbackShadowMigration } from '../../lib/agent-memory/local/migration.ts'

const [root, mode] = process.argv.slice(2)
const barrier = async () => {
  process.send?.({ type: 'ready' })
  await once(process, 'message', { signal: AbortSignal.timeout(10000) })
}
try {
  if (mode === 'claim') await withLocalMemoryClaim(root, 'fixture', barrier)
  else if (mode === 'rollback') await rollbackShadowMigration(root, { afterQuiescence: barrier })
  else {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: root,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      worker: async (context) => {
        await barrier()
        context.write('note.md', 'worker\n')
      },
    })
    if (mode === 'worker') {
      await service.enqueue({ id: 'job', summary: 'fixture' })
      await service.start('job')
    } else await service.enqueue({ id: 'loser', summary: 'probe' })
  }
  process.send?.({ type: 'done' })
} catch (error) {
  process.send?.({ type: 'error', message: (error as Error).message })
} finally {
  process.disconnect?.()
}
