import { stripVTControlCharacters } from 'node:util'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { Component, Editor, Focusable } from '@earendil-works/pi-tui'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export const label = (text: string, max = 180) =>
  Array.from(graphemes.segment(stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')))
    .slice(0, max)
    .map((part) => part.segment)
    .join('')
export async function workWidget(
  ctx: ExtensionContext,
  key: string,
  lines: string[],
  current: () => boolean,
) {
  if (!ctx.hasUI || ctx.mode !== 'tui') return
  if (lines.length === 0) {
    ctx.ui.setWidget(key, undefined)
    return
  }
  const { truncateToWidth } = await import('@earendil-works/pi-tui')
  if (!current()) return
  ctx.ui.setWidget(
    key,
    (_tui, theme) => ({
      invalidate() {},
      render: (width) =>
        current() ? lines.map((line) => truncateToWidth(theme.fg('muted', line), Math.max(0, width))) : [],
    }),
    { placement: 'aboveEditor' },
  )
}

/** Own modal Editor: never read, replace or paste into the underlying native composer. */
export async function editStagedText(ctx: ExtensionContext, text: string, imageCount: number) {
  if (!ctx.hasUI || ctx.mode !== 'tui')
    throw new Error('Staging text editor requires the native TUI; no composer replacement is used.')
  const { Editor: NativeEditor, matchesKey, truncateToWidth } = await import('@earendil-works/pi-tui')
  // Non-overlay custom screens restore saved composer text via setText on close,
  // resetting its caret. A public overlay leaves the underlying composer intact.
  return ctx.ui.custom<string | undefined>(
    (tui, theme, _keys, done) => {
      const muted = (value: string) => theme.fg('muted', value)
      const editor: Editor = new NativeEditor(tui, {
        borderColor: muted,
        selectList: {
          selectedPrefix: muted,
          selectedText: muted,
          description: muted,
          scrollInfo: muted,
          noMatch: muted,
        },
      })
      editor.setText(text)
      editor.disableSubmit = true
      const modal: Component & Focusable = {
        get focused() {
          return editor.focused
        },
        set focused(value: boolean) {
          editor.focused = value
        },
        invalidate: () => editor.invalidate(),
        render: (width) => [
          truncateToWidth(
            muted(`Staging only · ${imageCount} images retained · Ctrl+S save · Esc cancel`),
            width,
          ),
          ...editor.render(width),
        ],
        handleInput(data) {
          if (matchesKey(data, 'escape')) done(undefined)
          else if (matchesKey(data, 'ctrl+s')) done(editor.getExpandedText())
          else editor.handleInput(data)
        },
      }
      return modal
    },
    { overlay: true, overlayOptions: { anchor: 'center', width: '90%', maxHeight: '80%' } },
  )
}
