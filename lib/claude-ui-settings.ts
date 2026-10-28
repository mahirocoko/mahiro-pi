import type { KeybindingsManager, Theme, ToolRenderers } from '@earendil-works/pi-coding-agent'
import type { Component, SelectItem, SettingItem } from '@earendil-works/pi-tui'
import { createToolPresentation, type Geometry, type NativePresentation } from './claude-ui.ts'

import {
  PALETTE_MODES,
  PALETTE_THEMES,
  UI_DEFAULTS,
  type FixedPaletteMode,
  type PaletteMode,
  type UIPreferences,
} from './claude-ui-preferences.ts'
export {
  PALETTE_MODES,
  PALETTE_THEMES,
  UI_DEFAULTS,
  type FixedPaletteMode,
  type PaletteMode,
  type UIPreferences,
} from './claude-ui-preferences.ts'
export const PERSISTENCE_LIMIT =
  'Not persisted: no authorized own-UI DATA storage owner is available. Runtime controls remain usable; host settings and grants are unchanged.'
export type UISaveResult = { saved: boolean; message: string }

// A panel instance owns a copy, never a session entry or native settings object.
// No filesystem/permission fallback: runtime Apply is deliberately not Save.
export function createSettingsPanel(options: {
  tui: Pick<typeof import('@earendil-works/pi-tui'), 'SelectList' | 'Text' | 'matchesKey' | 'getKeybindings'>
  geometry: Geometry
  native: NativePresentation
  nativeTools: ReadonlyMap<string, ToolRenderers>
  keybindings: Pick<KeybindingsManager, 'matches'>
  theme: () => Theme
  initial: UIPreferences
  current: () => boolean
  change: (value: UIPreferences) => boolean
  persistence?: {
    status: string
    save: (value: UIPreferences) => UISaveResult
  }
  done: () => void
  requestRender: () => void
}): Component & { dispose(): void } {
  const original = { ...options.initial }
  let draft = { ...original }
  let closed = false
  let saving = false
  let expanded = false
  let scenario: PreviewScenario | 'focus' = 'focus'
  let listTop = 0
  let listHeight = 0
  let renderedWidth = 0
  let message = 'Changes apply live; Cancel restores the original runtime choices.'
  const current = () => !closed && options.current()
  const finish = (cancel: boolean) => {
    if (closed) return
    if (
      cancel &&
      options.current() &&
      (draft.palette !== original.palette ||
        draft.toolStyle !== original.toolStyle ||
        draft.diffView !== original.diffView ||
        draft.extraDetail !== original.extraDetail)
    )
      options.change({ ...original })
    closed = true
    options.done()
  }
  const items: SettingItem[] = [
    {
      id: 'palette',
      label: 'Palette',
      currentValue: draft.palette,
      values: [...PALETTE_MODES],
      description:
        'Only Mahiro tool rows and header (follow, claude, obsidian, ember, nordic); never the host theme or footer.',
    },
    {
      id: 'toolStyle',
      label: 'Tool style',
      currentValue: draft.toolStyle,
      values: ['transparent', 'tinted'],
      description: 'Transparent output or a subtle state background. No grouping or execution changes.',
    },
    {
      id: 'diffView',
      label: 'Edit diff',
      currentValue: draft.diffView,
      values: ['split', 'unified', 'native'],
      description:
        'Split when wide and captured lines fit; unified when narrow or when display width wraps a pane. Writes show submitted content.',
    },
    {
      id: 'extraDetail',
      label: 'Extra detail',
      currentValue: draft.extraDetail ? 'on' : 'off',
      values: ['off', 'on'],
      description:
        'More collapsed output rows plus captured duration. Expansion always keeps all captured text.',
    },
    {
      id: 'apply',
      label: 'Apply for this runtime',
      currentValue: 'select',
      values: ['select', 'apply'],
      description: 'Keep these live choices and close. Not saved to disk.',
    },
    {
      id: 'reset',
      label: 'Reset runtime defaults',
      currentValue: 'select',
      values: ['select', 'reset'],
      description:
        'Preview follow / transparent / split / detail off. Cancel can still restore your original choices.',
    },
    {
      id: 'cancel',
      label: 'Cancel changes',
      currentValue: 'select',
      values: ['select', 'cancel'],
      description: 'Restore the choices from when this panel opened.',
    },
    {
      id: 'preview',
      label: 'Preview scenario',
      currentValue: scenario,
      values: ['focus', 'read', 'bash', 'edit', 'write', 'pending', 'error'],
      description:
        'Synthetic only: focus follows the setting; select a sample to inspect any tool/state. No execution or runtime change.',
    },
    {
      id: 'save',
      label: 'Save preferences',
      currentValue: 'select',
      values: ['select', 'save'],
      description:
        'Explicit durable Save through the own-UI Root only; Apply remains runtime-only. Unavailable or stale storage never reports saved.',
    },
  ]
  const choices: SelectItem[] = items.map((item) => ({
    value: item.id,
    label: '',
    description: item.description,
  }))
  const sync = () => {
    for (const key of ['palette', 'toolStyle', 'diffView', 'extraDetail'] as const)
      items.find((item) => item.id === key)!.currentValue =
        key === 'extraDetail' ? (draft.extraDetail ? 'on' : 'off') : String(draft[key])
    items.find((item) => item.id === 'preview')!.currentValue = scenario
    for (const [index, item] of items.entries()) choices[index].label = `${item.label}  ${item.currentValue}`
  }
  sync()
  // Public SelectList is the sole selection owner. SettingsList has no public
  // focus getter/callback; never mirror its private index with a keyboard counter.
  const list = new options.tui.SelectList(choices, items.length, {
    selectedPrefix: (s) => options.theme().fg('accent', s),
    selectedText: (s) => options.theme().fg('accent', s),
    description: (s) => options.theme().fg('dim', s),
    scrollInfo: (s) => options.theme().fg('dim', s),
    noMatch: (s) => options.theme().fg('dim', s),
  })
  list.onSelectionChange = () => options.requestRender()
  list.onCancel = () => finish(true)
  list.onSelect = ({ value: id }) => {
    if (saving || closed) return
    if (!current()) {
      message = 'Stale panel: no runtime changes applied.'
      return
    }
    if (id === 'preview') {
      const values = items.find((item) => item.id === id)!.values!
      scenario = values[(values.indexOf(scenario) + 1) % values.length] as typeof scenario
      sync()
      options.requestRender()
      return
    }
    if (id === 'save') {
      if (!options.persistence) message = PERSISTENCE_LIMIT
      else {
        saving = true
        try {
          const result = options.persistence.save({ ...draft })
          message = result.message
          if (result.saved && current()) finish(false)
        } catch {
          // Never render arbitrary owner/JSON/filesystem exception contents.
          message = 'Own-UI storage unavailable; preferences not saved.'
        } finally {
          saving = false
        }
      }
      options.requestRender()
      return
    }
    if (id === 'apply') {
      finish(false)
      return
    }
    if (id === 'cancel') {
      finish(true)
      return
    }
    const item = items.find((entry) => entry.id === id)!
    const value = item.values![(item.values!.indexOf(item.currentValue) + 1) % item.values!.length]
    const candidate =
      id === 'reset'
        ? { ...UI_DEFAULTS }
        : ({
            ...draft,
            [id]: id === 'extraDetail' ? value === 'on' : value,
          } as UIPreferences)
    if (options.change({ ...candidate })) {
      draft = candidate
      message =
        id === 'reset'
          ? 'Previewing documented runtime defaults.'
          : `Changed ${id} → ${value}. Preview below uses the actual renderer.`
    } else message = 'Choice unavailable or stale; previous runtime choices retained.'
    sync()
    options.requestRender()
  }
  const text = (s: string, width: number) => new options.tui.Text(s, 0, 0).render(Math.max(1, width))
  return {
    render(width) {
      if (width <= 0) return []
      const theme = options.theme()
      const heading = text(theme.bold(theme.fg('accent', 'Mahiro UI settings · live preview')), width)
      const rows = list.render(Math.max(8, width))
      listTop = heading.length + 1
      listHeight = rows.length
      renderedWidth = width
      const focused = list.getSelectedItem()?.value ?? 'palette'
      return [
        ...heading,
        '',
        ...rows,
        ...text(items.find((item) => item.id === focused)?.description ?? '', width),
        ...text(
          theme.fg('dim', '↑/↓ focus · Enter/Space change · Esc cancel · Preview scenario selects samples'),
          width,
        ),
        '',
        ...text(theme.fg('warning', options.persistence?.status ?? PERSISTENCE_LIMIT), width),
        '',
        ...text(theme.fg('muted', current() ? message : 'Stale panel: close and reopen settings.'), width),
        '',
        ...text(theme.bold('Preview · synthetic sample, not tool execution'), width),
        ...renderSettingsPreview(
          draft,
          width,
          theme,
          options.geometry,
          options.native,
          expanded,
          options.nativeTools,
          scenario === 'focus' ? focusedPreview(focused) : [scenario],
        ),
      ].map((line) => options.geometry.truncateToWidth(line, width, ''))
    },
    invalidate() {
      list.invalidate()
    },
    handleInput(data) {
      if (saving || closed) return
      if (!current()) {
        finish(false)
        return
      }
      const selectorKeys = options.tui.getKeybindings()
      // Match the same public actions SelectList owns before local conveniences.
      // A remapped Space must navigate/cancel, not activate or expand the preview.
      if (
        selectorKeys.matches(data, 'tui.select.up') ||
        selectorKeys.matches(data, 'tui.select.down') ||
        selectorKeys.matches(data, 'tui.select.confirm') ||
        selectorKeys.matches(data, 'tui.select.cancel')
      )
        list.handleInput(data)
      else if (options.keybindings.matches(data, 'app.tools.expand')) expanded = !expanded
      else if (options.tui.matchesKey(data, 'space')) {
        const selected = list.getSelectedItem()
        if (selected) list.onSelect?.(selected)
      } else list.handleInput(data)
      options.requestRender()
    },
    handleMouse(event) {
      if (saving || closed || !current()) return undefined
      // Mouse coordinates are component-local. Only the rendered selector owns
      // these rows; wrapped heading/description/preview are not click targets.
      if (event.x < 0 || event.x >= renderedWidth || event.y < listTop || event.y >= listTop + listHeight)
        return undefined
      const result = list.handleMouse({ ...event, y: event.y - listTop })
      if (result) options.requestRender()
      return result
    },
    dispose() {
      if (!closed) finish(true)
    },
  }
}

export type PreviewScenario = 'read' | 'bash' | 'edit' | 'write' | 'pending' | 'error'
function focusedPreview(id: string): PreviewScenario[] {
  if (id === 'diffView') return ['edit']
  if (id === 'toolStyle') return ['bash', 'pending', 'error']
  if (id === 'extraDetail') return ['read']
  if (id === 'palette' || id === 'preview') return ['read', 'edit', 'write']
  return ['edit']
}

// Fixed, in-memory synthetic captures only. Paths/commands are display data,
// never read or executed. Native factory products supply presentation, not execute.
const previewSamples = {
  read: {
    name: 'read',
    args: { path: 'sample.ts', offset: 1, limit: 12 },
    output: Array.from(
      { length: 12 },
      (_, i) => `${i + 1} // ภาษาไทย 中文 👩🏽‍💻 é · captured sample row`,
    ).join('\n'),
  },
  bash: {
    name: 'bash',
    args: { command: "printf 'synthetic sample'" },
    output: 'Synthetic command output\nNo command was executed.',
  },
  edit: {
    name: 'edit',
    args: { path: 'sample.ts' },
    output: 'Applied sample edit.\nCaptured status retained.',
    details: {
      diff: " 1 // ภาษาไทย 中文 👩🏽‍💻\n-2 const title = 'old word';\n-3 const enabled = false;\n+2 const title = 'new word';\n+3 const enabled = true;\n 4 export { title };",
    },
  },
  write: {
    name: 'write',
    args: {
      path: 'sample.md',
      content: '# Synthetic sample\nภาษาไทย 中文 👩🏽‍💻 é\nSubmitted content only.\n',
    },
    output: 'Synthetic write status. No file was written.',
  },
  pending: {
    name: 'bash',
    args: { command: 'synthetic pending command' },
    output: 'Synthetic partial output; not completed.',
  },
  error: {
    name: 'bash',
    args: { command: 'synthetic failing command' },
    output: 'Synthetic failure: command exited with code 1.',
  },
} as const

/** Real presentation path shared by panel and deterministic fixtures. */
export function renderSettingsPreview(
  preferences: UIPreferences,
  width: number,
  theme: Theme,
  geometry: Geometry,
  native: NativePresentation,
  expanded: boolean,
  nativeTools: ReadonlyMap<string, ToolRenderers>,
  scenarios: readonly PreviewScenario[] = ['edit'],
): string[] {
  return scenarios.flatMap((scenario, index) => {
    const sample = previewSamples[scenario]
    const base = nativeTools.get(sample.name)
    if (!base) return [] // No fabricated native presentation when unavailable.
    const renderer = createToolPresentation(
      sample.name,
      base,
      geometry,
      native,
      (host) => host,
      () => preferences,
    )
    const ctx = {
      args: sample.args,
      state: {},
      outputPad: 0,
      isPartial: scenario === 'pending',
      isError: scenario === 'error',
      argsComplete: true,
      executionStarted: true,
      durationMs: scenario === 'pending' ? undefined : 24,
      toolCallId: `settings-preview-${scenario}`,
      cwd: '',
      expanded,
      showImages: false,
      invalidate() {},
    } as Parameters<NonNullable<typeof renderer.renderCall>>[2]
    const result = {
      content: [{ type: 'text' as const, text: sample.output }],
      details: 'details' in sample ? sample.details : undefined,
    }
    return [
      ...(index ? [''] : []),
      ...renderer.renderCall!(ctx.args, theme, ctx).render(width),
      ...renderer.renderResult!(result, { expanded, isPartial: ctx.isPartial }, theme, ctx).render(width),
    ]
  })
}
