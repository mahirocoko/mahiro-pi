import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { createWebActivityPublisher, readWebActivityTarget } from '../lib/worker-activity-web.ts'
import { startWorkerActivity } from '../lib/worker-activity.ts'

/** Optional explicitly registered resource, separate from the guards-first13 manifest.
 * One profile target enables every TUI session automatically in both Herdr runtimes.
 */
export default function mahiroWorkerActivity(pi: ExtensionAPI) {
  let active:
    | {
        manager: object
        activity: ReturnType<typeof startWorkerActivity>
        web?: ReturnType<typeof createWebActivityPublisher>
        diagnostic: string
      }
    | undefined
  let generation = 0
  const dispose = () => {
    generation++
    active?.web?.dispose()
    active?.activity.dispose()
    active = undefined
  }
  pi.on('session_start', async (_event, ctx) => {
    // Embedded SDK/RPC children share the process. They must not retire their TUI parent.
    if (ctx.mode !== 'tui') return
    dispose()
    const mine = generation
    let web: ReturnType<typeof createWebActivityPublisher> | undefined
    let diagnostic = 'Observer not configured; one-time profile target required'
    try {
      const { getAgentDir } = await import('@earendil-works/pi-coding-agent')
      if (mine !== generation) return
      const root = readWebActivityTarget(getAgentDir())
      if (root) web = createWebActivityPublisher(ctx, { root })
    } catch {
      diagnostic = 'Observer unavailable: invalid/private target configuration; no fallback'
    }
    if (mine !== generation) {
      web?.dispose()
      return
    }
    const activity = startWorkerActivity(ctx, {
      observe: web ? (read, current) => web?.publish(read, current) : undefined,
    })
    active = { manager: ctx.sessionManager, activity, web, diagnostic }
  })
  pi.on('session_shutdown', (_event, ctx) => {
    if (ctx.mode === 'tui' && (!active || active.manager === ctx.sessionManager)) dispose()
  })
  pi.registerCommand('mh-herdr-web-observer', {
    description: 'Automatic Herdr Web observer health (status); stop suspends this session only',
    handler: async (args, ctx) => {
      const state = ctx.mode === 'tui' && active?.manager === ctx.sessionManager ? active : undefined
      if (!state) {
        ctx.ui.notify('Observer unavailable: no TUI owner', 'warning')
        return
      }
      switch (args.trim() || 'status') {
        case 'stop':
          state.web?.dispose()
          state.web = undefined
          state.diagnostic =
            'Observer suspended for this session; next session/reload uses profile configuration'
          ctx.ui.notify(state.diagnostic, 'info')
          break
        case 'start':
          ctx.ui.notify(
            'No per-session start is needed. Configure herdr-web.json once; activation/reload is separate.',
            'info',
          )
          break
        case 'status':
          ctx.ui.notify(state.web?.status() ?? state.diagnostic, 'info')
          break
        default:
          ctx.ui.notify('Usage: /mh-herdr-web-observer status | stop', 'warning')
      }
    },
  })
}
