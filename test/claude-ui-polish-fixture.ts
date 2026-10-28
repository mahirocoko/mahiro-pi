// Deterministic raw public-TUI evidence; no provider, profile or terminal probe.
import { pathToFileURL } from 'node:url'
import { prepareDiff, renderPreparedDiff } from '../lib/claude-ui-diff.ts'
import {
  createSettingsPanel,
  PALETTE_THEMES,
  UI_DEFAULTS,
  type FixedPaletteMode,
  type UIPreferences,
} from '../lib/claude-ui-settings.ts'
import { geometry, native, nativeTools, theme, themeFrom } from './claude-ui-fixture.ts'

const diffSample = prepareDiff(
  " 3 // Native edit result · ภาษาไทย 中文 👩🏽‍💻\n-4 const title = 'old story';\n-5 const enabled = false;\n+4 const title = 'new story';\n+5 const enabled = true;\n 6 export { title, enabled };\n    ...\n-20 removed();\n 21 keep();\n+21 added();",
)!

export function polishFixture(
  kind: string,
  width: number,
  changed = false,
  paletteName = 'mahiro-claude-dark',
): string[] {
  const activeTheme = themeFrom(paletteName)
  if (kind === 'diff') return renderPreparedDiff(diffSample, width, activeTheme, geometry)
  if (kind === 'themes') {
    return (Object.entries(PALETTE_THEMES) as [FixedPaletteMode, string][]).flatMap(
      ([mode, themeId], index) => {
        const candidate = themeFrom(themeId)
        const swatch = [
          candidate.bold(candidate.fg('accent', `=== ${mode} (${themeId}) ===`)),
          candidate.fg('bashMode', '● accentAlt'),
          candidate.fg('syntaxKeyword', 'export'),
          candidate.fg('syntaxFunction', 'renderDiff'),
          candidate.fg('syntaxString', "'ภาษาไทย'"),
          candidate.style(' surface ', { fg: 'text', bg: 'toolPendingBg' }),
        ].join('  ')
        return [
          ...(index ? [''] : []),
          swatch,
          ...renderPreparedDiff(diffSample, width, candidate, geometry, width >= 88),
        ]
      },
    )
  }
  let value: UIPreferences = { ...UI_DEFAULTS }
  const panel = createSettingsPanel({
    tui: geometry,
    geometry,
    native,
    nativeTools,
    keybindings: geometry.getKeybindings(),
    theme: () =>
      value.palette === 'follow'
        ? theme
        : themeFrom(PALETTE_THEMES[value.palette as FixedPaletteMode] ?? 'mahiro-claude-dark'),
    initial: value,
    current: () => true,
    change(next) {
      value = next
      return true
    },
    done() {},
    requestRender() {},
  })
  if (changed) {
    panel.handleInput!('\r') // palette
    panel.handleInput!('\x1b[B')
    panel.handleInput!('\r') // tinted
    panel.handleInput!('\x1b[B')
    panel.handleInput!('\r') // unified
    panel.handleInput!('\x1b[B')
    panel.handleInput!('\r') // detail on
  }
  return panel.render(width)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const themeArg = process.argv.find((arg) => arg.startsWith('--theme='))?.slice('--theme='.length)
  const lines = polishFixture(
    process.argv[2] ?? 'diff',
    Number(process.argv[3] ?? '110'),
    process.argv.includes('--changed'),
    themeArg ?? 'mahiro-claude-dark',
  )
  console.log(
    (process.argv.includes('--plain') ? lines.map(geometry.stripTerminalSequences) : lines).join('\n'),
  )
}
