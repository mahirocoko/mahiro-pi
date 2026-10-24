import { randomUUID } from 'node:crypto'
import type { ExtensionAPI, ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent'
import { createBranchJournal, type JournalTicket } from './journal.ts'
import {
  emptyQueue,
  isQueueOperation,
  reduceQueue,
  QUEUE_MESSAGE,
  queueReceipts,
  queueStatus,
  type QueueImage,
  type QueueLane,
  type QueueOperation,
  type QueueRow,
} from './queue-model.ts'
import { editStagedText, label, workWidget } from './view.ts'
import { registerWorkflowSurface } from '../workflow-hub.ts'

export function registerSessionQueue(pi: ExtensionAPI) {
  const journal = createBranchJournal(
    pi,
    'mahiro-session-queue-v1',
    emptyQueue,
    isQueueOperation,
    reduceQueue,
  )
  let receiptIndex = 0
  let receiptLastId: string | undefined
  let receipts = new Map<string, string>()
  function observe(entries: SessionEntry[]) {
    if (receiptIndex > entries.length || (receiptIndex && entries[receiptIndex - 1]?.id !== receiptLastId)) {
      receiptIndex = 0
      receipts = new Map()
    }
    for (const [key, value] of queueReceipts(entries.slice(receiptIndex))) receipts.set(key, value)
    receiptIndex = entries.length
    receiptLastId = entries.at(-1)?.id
    return receipts
  }
  function view(ctx: ExtensionContext) {
    const result = journal.read(ctx)
    observe(result.entries)
    return { ...result, receipts }
  }
  async function refresh(ctx: ExtensionContext) {
    if (!journal.active(ctx)) return
    const { state, ticket, receipts } = view(ctx)
    const retained = state.rows.filter((row) => queueStatus(row, receipts) !== 'recorded')
    const lines = retained.length
      ? [
          `Staging · ${retained.length} retained · capture ${state.capture} · /mh-queue`,
          ...retained
            .slice(0, 3)
            .map(
              (row) =>
                `${row.lane} · ${queueStatus(row, receipts)} · ${label(row.text || '(images)')} [${row.images.length} images]`,
            ),
          ...(retained.length > 3 ? [`${retained.length - 3} more retained`] : []),
        ]
      : []
    await workWidget(ctx, 'mahiro-session-queue', lines, () => {
      try {
        journal.assertCurrent(ctx, ticket)
        return true
      } catch {
        return false
      }
    })
  }
  function stage(ctx: ExtensionContext, text: string, images: QueueImage[], lane: QueueLane) {
    const { ticket } = view(ctx)
    return journal.write(ctx, { kind: 'stage', id: randomUUID(), text, images, lane }, ticket)
  }
  function change(ctx: ExtensionContext, operation: QueueOperation, ticket: JournalTicket) {
    return journal.write(ctx, operation, ticket)
  }
  function handoff(ctx: ExtensionContext, row: QueueRow, ticket: JournalTicket) {
    const current = view(ctx)
    journal.assertCurrent(ctx, ticket)
    const first = current.state.rows.find((item) => item.lane === row.lane && !item.attemptId)
    if (!row.attemptId && first?.id !== row.id)
      throw new Error('Hand off the first staged row in this lane, or explicitly move this row first.')
    const attemptId = randomUUID()
    // Durable intent first. A throw or missing receipt leaves a locked retained row;
    // neither void send return nor aggregate pending is a per-row acknowledgement.
    journal.write(ctx, { kind: 'attempt', id: row.id, attemptId }, ticket)
    pi.sendMessage(
      {
        customType: QUEUE_MESSAGE,
        content: [{ type: 'text', text: row.text }, ...row.images],
        display: true,
        details: { version: 1, rowId: row.id, attemptId },
      },
      { triggerTurn: true, deliverAs: row.lane },
    )
  }
  pi.on('input', async (event, ctx) => {
    // Never capture native commands/Esc, idle submissions, RPC or other extensions.
    if (
      event.source !== 'interactive' ||
      event.text.startsWith('/') ||
      ctx.isIdle() ||
      !event.streamingBehavior
    )
      return
    try {
      const { state } = view(ctx)
      if (state.capture === 'off') return
      stage(ctx, event.text, event.images ?? [], state.capture)
    } catch (error) {
      ctx.ui.notify(
        `Not staged; original input continues natively: ${error instanceof Error ? error.message : 'journal unavailable'}`,
        'warning',
      )
      return { action: 'continue' as const }
    }
    // Presentation failure after committed intent must not also send the native input.
    try {
      await refresh(ctx)
    } catch {
      /* durable row remains available in /mh-queue */
    }
    return { action: 'handled' as const }
  })
  pi.on('session_start', (_event, ctx) => refresh(ctx))
  pi.on('context', (_event, ctx) => refresh(ctx))
  pi.on('turn_end', (_event, ctx) => refresh(ctx))
  pi.on('session_shutdown', (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setWidget('mahiro-session-queue', undefined)
  })
  const queueCommand: Parameters<ExtensionAPI['registerCommand']>[1] = {
    description:
      'Editable extension staging, not native atomic queue editing. capture off|steer|followUp; otherwise open staging.',
    async handler(args, ctx) {
      if (!ctx.hasUI) return
      try {
        const captured = view(ctx)
        if (args.trim()) {
          const match = /^capture (off|steer|followUp)$/.exec(args.trim())
          if (!match) throw new Error('Use /mh-queue or /mh-queue capture off|steer|followUp.')
          change(ctx, { kind: 'capture', lane: match[1] as QueueLane | 'off' }, captured.ticket)
          await refresh(ctx)
          ctx.ui.notify(
            `Busy interactive capture: ${match[1]}. Staging is not native queue editing; explicit handoff required.`,
            'info',
          )
          return
        }
        const choices = [
          'Stage text',
          'Busy capture',
          ...captured.state.rows.map(
            (row) =>
              `${row.id} · ${row.lane} · ${queueStatus(row, captured.receipts)} · ${label(row.text || '(images)')} [${row.images.length} images]`,
          ),
        ]
        const choice = await ctx.ui.select(
          'Extension staging — native queued rows are not editable here',
          choices,
        )
        if (!choice) return
        view(ctx)
        journal.assertCurrent(ctx, captured.ticket)
        if (choice === 'Stage text') {
          const text = await editStagedText(ctx, '', 0)
          if (text === undefined) return
          const lane = await ctx.ui.select('Handoff lane (no auto-send)', ['followUp', 'steer'])
          if (!lane) return
          view(ctx)
          journal.assertCurrent(ctx, captured.ticket)
          stage(ctx, text, [], lane as QueueLane)
        } else if (choice === 'Busy capture') {
          const lane = await ctx.ui.select(
            'Capture future busy interactive input; original native pending rows remain native',
            ['off', 'steer', 'followUp'],
          )
          if (!lane) return
          change(ctx, { kind: 'capture', lane: lane as QueueLane | 'off' }, captured.ticket)
        } else {
          const row = captured.state.rows[choices.indexOf(choice) - 2]
          if (!row) return
          const status = queueStatus(row, captured.receipts)
          const actions = row.attemptId
            ? ['Inspect receipt', 'Discard retained row']
            : ['Edit text', 'Remove images', 'Move / change lane', 'Hand off once', 'Discard retained row']
          const action = await ctx.ui.select(
            `${status}: recorded = matching native journal entry, NOT model delivery/completion. Unconfirmed stays locked; no retry/resend.`,
            actions,
          )
          if (!action) return
          if (action === 'Inspect receipt') {
            ctx.ui.notify(
              JSON.stringify({
                rowId: row.id,
                attemptId: row.attemptId,
                nativeEntryId: captured.receipts.get(`${row.id}:${row.attemptId}`) ?? null,
                status,
                guarantee:
                  'Native journal observation only; not model success, execution or human acceptance.',
              }),
              'info',
            )
          } else if (action === 'Edit text') {
            const text = await editStagedText(ctx, row.text, row.images.length)
            if (text === undefined) return
            change(ctx, { kind: 'edit', id: row.id, text }, captured.ticket)
          } else if (action === 'Remove images') {
            if (
              await ctx.ui.confirm(
                'Explicitly remove staged images?',
                `${row.images.length} images; native composer and attachments are untouched.`,
              )
            )
              change(ctx, { kind: 'remove-images', id: row.id }, captured.ticket)
          } else if (action === 'Move / change lane') {
            const lane = await ctx.ui.select('Lane', ['followUp', 'steer'])
            if (!lane) return
            const index = await ctx.ui.input(
              'Position, 1-based across staging rows',
              String(captured.state.rows.indexOf(row) + 1),
            )
            if (index === undefined) return
            if (!/^\d+$/.test(index) || Number(index) < 1 || Number(index) > captured.state.rows.length)
              throw new Error('Invalid row position.')
            change(
              ctx,
              { kind: 'move', id: row.id, lane: lane as QueueLane, index: Number(index) - 1 },
              captured.ticket,
            )
          } else if (action === 'Hand off once') {
            if (
              !(await ctx.ui.confirm(
                'Hand off this staged row once?',
                `${row.lane}: ${label(row.text)}. Locked afterward; no automatic resend. Native pending rows cannot be edited here.`,
              ))
            )
              return
            handoff(ctx, row, captured.ticket)
          } else if (action === 'Discard retained row') {
            if (
              await ctx.ui.confirm(
                'Discard extension staging record?',
                row.attemptId
                  ? 'This does NOT cancel native pending work. Recreating/resending this text can duplicate delivery.'
                  : label(row.text),
              )
            )
              change(ctx, { kind: 'discard', id: row.id }, captured.ticket)
          }
        }
        await refresh(ctx)
      } catch (error) {
        // A pending modal can outlive reload; retired contexts cannot access UI either.
        if (journal.active(ctx))
          ctx.ui.notify(error instanceof Error ? error.message : 'Staging unavailable.', 'error')
      }
    },
  }
  pi.registerCommand('mh-queue', queueCommand)
  registerWorkflowSurface(pi, {
    id: 'queue',
    label: 'Queue / staging',
    open: (ctx) => queueCommand.handler('', ctx),
  })
  return { view, stage, change, handoff }
}
