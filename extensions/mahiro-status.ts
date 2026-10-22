import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { startActivity } from '../lib/activity.ts'
import { footerRepaint, renderFooter, sessionTotals, type FooterState } from '../lib/footer.ts'
import { quotaController } from '../lib/quota.ts'
import { sharedOwner, start } from '../lib/status.ts'

export default function mahiroStatus(pi: ExtensionAPI) {
  let current: ReturnType<typeof start> | undefined
  let activity: ReturnType<typeof startActivity> | undefined
  let generation = 0
  // Host runtime imports are deferred to interactive session startup. Source
  // tests need no installed host peer, and non-TUI children never own the UI.
  pi.on('session_start', async (_event, ctx) => {
    const revision = ++generation
    current?.dispose()
    current = undefined
    activity?.dispose()
    activity = undefined
    if (ctx.mode !== 'tui') return
    const geometry = await import('@earendil-works/pi-tui')
    if (revision !== generation) return
    sharedOwner().dispose?.()
    let requestRender = () => {}
    let footerChanged = () => {}
    let state: FooterState = { git: 'git unknown', activity: 'idle', hideContext: false, quota: [] }
    const quota = quotaController(ctx, () => requestRender())
    ctx.ui.setStatus('mahiro-status', undefined)
    ctx.ui.setFooter((tui, _theme, data) => {
      requestRender = () => tui.requestRender()
      const totals = sessionTotals()
      const footer = footerRepaint(
        (width) =>
          renderFooter(
            ctx,
            pi.getSettings(),
            data,
            { ...state, quota: quota.view().segments },
            width,
            geometry,
            totals,
          ),
        () => requestRender(),
      )
      footerChanged = footer.changed
      const unsubscribe = data.onBranchChange(requestRender)
      return {
        render: footer.render,
        invalidate() {},
        dispose() {
          unsubscribe()
          requestRender = () => {}
          footerChanged = () => {}
        },
      }
    })
    current = start(ctx, {
      presentation: {
        render(next) {
          state = { ...state, ...next }
          footerChanged()
        },
        tick: () => quota.tick(),
        tokens: () => quota.view().tokens,
        invalidate: (model) => quota.invalidate(model),
        dispose() {
          quota.dispose()
          ctx.ui.setFooter(undefined)
        },
      },
    })
    let interrupt = 'escape'
    activity = startActivity(ctx, { interrupt: () => interrupt })
    try {
      const sdk = await import('@earendil-works/pi-coding-agent')
      if (revision !== generation) return
      if (typeof sdk.keyText === 'function') {
        const label = sdk.keyText('app.interrupt').trim()
        if (label) interrupt = label
      }
    } catch {
      /* The public default binding is escape. */
    }
  })
  pi.on('session_shutdown', () => {
    generation++
    current?.dispose()
    current = undefined
    activity?.dispose()
    activity = undefined
  })
  pi.on('tool_execution_start', (event) => {
    current?.toolStart(event.toolCallId, event.toolName)
    activity?.toolStart(event.toolCallId, event.toolName)
  })
  pi.on('tool_execution_end', (event) => {
    current?.toolEnd(event.toolCallId)
    activity?.toolEnd(event.toolCallId)
  })
  pi.on('agent_start', () => {
    current?.tick()
    activity?.begin()
  })
  pi.on('turn_start', () => activity?.turn())
  pi.on('message_update', (event) => activity?.stream(event.assistantMessageEvent.type))
  pi.on('agent_end', () => activity?.finish())
  pi.on('agent_settled', () => {
    current?.settled()
    activity?.finish()
  })
  pi.on('model_select', (event) => current?.modelChanged(event.model))
  pi.on('thinking_level_select', () => current?.tick())
  pi.on('message_end', (event) => {
    if (event.message.role === 'assistant') {
      current?.contextFresh(event.message)
      activity?.assistantEnd(event.message.stopReason)
    }
  })
  pi.on('session_compact', () => current?.tick())
}
