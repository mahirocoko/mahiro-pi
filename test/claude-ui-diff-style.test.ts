import assert from 'node:assert/strict'
import test from 'node:test'
import { Theme } from '@earendil-works/pi-coding-agent'
import { prepareDiff, renderPreparedDiff } from '../lib/claude-ui-diff.ts'
import { createToolPresentation } from '../lib/claude-ui.ts'
import { geometry, native, renderContext, theme } from './claude-ui-fixture.ts'

type Style = { fg: string; bg: string; bold: boolean; dim: boolean; inverse: boolean }
type StyledChar = Style & { char: string }

// Decode the SGR subset emitted by the public Theme/TUI helpers. This examines
// actual state at each character rather than assuming nested resets restore it.
function styledChars(line: string): StyledChar[] {
  const result: StyledChar[] = []
  const state: Style = { fg: 'default', bg: 'default', bold: false, dim: false, inverse: false }
  for (let i = 0; i < line.length; ) {
    const ansi = /^\x1b\[([\d;]*)m/.exec(line.slice(i))
    if (ansi) {
      const codes = (ansi[1] || '0').split(';').map(Number)
      for (let n = 0; n < codes.length; n++) {
        const code = codes[n]!
        if (code === 0)
          Object.assign(state, { fg: 'default', bg: 'default', bold: false, dim: false, inverse: false })
        else if (code === 1) state.bold = true
        else if (code === 2) state.dim = true
        else if (code === 22) {
          state.bold = false
          state.dim = false
        } else if (code === 7) state.inverse = true
        else if (code === 27) state.inverse = false
        else if (code === 39) state.fg = 'default'
        else if (code === 49) state.bg = 'default'
        else if ((code === 38 || code === 48) && (codes[n + 1] === 2 || codes[n + 1] === 5)) {
          const count = codes[n + 1] === 2 ? 5 : 3
          const color = codes.slice(n, n + count).join(';')
          if (code === 38) state.fg = color
          else state.bg = color
          n += count - 1
        }
      }
      i += ansi[0].length
    } else {
      const char = String.fromCodePoint(line.codePointAt(i)!)
      result.push({ char, ...state })
      i += char.length
    }
  }
  return result
}

function stateAt(line: string, fragment: string, occurrence = 0): StyledChar {
  const chars = styledChars(line)
  const text = chars.map((cell) => cell.char).join('')
  let start = -1
  for (let i = 0; i <= occurrence; i++) start = text.indexOf(fragment, start + 1)
  assert.notEqual(start, -1, `missing ${fragment} in ${text}`)
  return chars[Array.from(text.slice(0, start)).length]!
}

function makeTheme(
  appearance: 'dark' | 'light',
  mode: 'truecolor' | '256color',
  overrides: { surface?: string; defaults?: boolean; dim?: boolean } = {},
): Theme {
  const dark = appearance === 'dark'
  const entries = Object.keys(theme.colors)
  const fg: Record<string, string | number> = Object.fromEntries(
    entries.map((key) => [key, dark ? '#eeeeee' : '#171717']),
  )
  const bg = Object.fromEntries(entries.map((key) => [key, dark ? '#252933' : '#f5f4f2']))
  fg.text = overrides.defaults ? '' : dark ? '#eeeeee' : '#171717'
  fg.toolDiffRemoved = overrides.defaults ? 1 : dark ? '#e05a66' : '#b6273a'
  fg.toolDiffAdded = overrides.defaults ? 2 : dark ? '#42be6f' : '#188142'
  bg.toolPendingBg = overrides.defaults ? '' : (overrides.surface ?? (dark ? '#252933' : '#f5f4f2'))
  delete bg.text
  delete bg.toolDiffRemoved
  delete bg.toolDiffAdded
  return new Theme(fg as never, bg as never, mode, { appearance, dim: overrides.dim ? ['text'] : [] })
}

function rgb(color: string): number[] {
  const match = /^(?:38|48);2;(\d+);(\d+);(\d+)$/.exec(color)
  assert.ok(match, `expected measured truecolor, got ${color}`)
  return match.slice(1).map(Number)
}

function contrast(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = rgb(color).map((value) => {
      const channel = value / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  }
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const pair = prepareDiff('-1 alpha OLD tail\n+1 alpha NEW tail\n 2 unmodified')!
const plain = (lines: string[]) => lines.map(geometry.stripTerminalSequences)

for (const appearance of ['dark', 'light'] as const) {
  test(`${appearance} diff uses neutral, legible text and restores row backgrounds`, () => {
    const palette = makeTheme(appearance, 'truecolor')
    const lines = renderPreparedDiff(pair, 90, palette, geometry)
    const line = lines.find((value) => geometry.stripTerminalSequences(value).includes('alpha OLD tail'))!
    const before = stateAt(line, 'alpha')
    const changed = stateAt(line, 'OLD')
    const after = stateAt(line, 'tail')
    const separator = stateAt(line, '│')
    const nextBefore = stateAt(line, 'alpha', 1)
    const nextChanged = stateAt(line, 'NEW')
    const nextAfter = stateAt(line, 'tail', 1)

    assert.equal(before.fg, changed.fg)
    assert.equal(before.fg, after.fg)
    assert.notEqual(before.bg, changed.bg)
    assert.equal(before.bg, after.bg)
    assert.notEqual(nextBefore.bg, nextChanged.bg)
    assert.equal(nextBefore.bg, nextAfter.bg)
    assert.notEqual(before.bg, nextBefore.bg)
    assert.equal(before.bold, false)
    assert.equal(changed.bold, true)
    assert.equal(after.bold, false)
    assert.equal(separator.bg, 'default')
    assert.equal(separator.bold, false)
    assert.ok(styledChars(line).every((cell) => !cell.inverse))
    for (const state of [before, changed, nextBefore, nextChanged]) {
      assert.ok(contrast(state.fg, state.bg) >= 4.5, `${state.fg} on ${state.bg}`)
    }
    const context = lines.find((value) => geometry.stripTerminalSequences(value).includes('unmodified'))!
    assert.equal(stateAt(context, 'unmodified').bg, 'default')
  })
}

test('the authored dark theme also has measurable text contrast in the diff', () => {
  const line = renderPreparedDiff(pair, 90, theme, geometry).find((value) =>
    geometry.stripTerminalSequences(value).includes('alpha OLD tail'),
  )!
  for (const fragment of ['alpha', 'OLD', 'NEW']) {
    const state = stateAt(line, fragment)
    assert.ok(contrast(state.fg, state.bg) >= 4.5, `${state.fg} on ${state.bg}`)
  }
})

test('a faint theme text token is restored after a bold changed word', () => {
  const palette = makeTheme('dark', 'truecolor', { dim: true })
  const line = renderPreparedDiff(pair, 90, palette, geometry).find((value) =>
    geometry.stripTerminalSequences(value).includes('alpha OLD tail'),
  )!
  assert.equal(stateAt(line, 'alpha').dim, true)
  assert.equal(stateAt(line, 'OLD').bold, true)
  assert.equal(stateAt(line, 'tail').dim, true)
  assert.equal(stateAt(line, 'tail').bold, false)
})

test('wrapped changed words keep their style without leaking to padding, next lines or cells', () => {
  const long = prepareDiff(`-1 alpha ${'W'.repeat(38)} tail\n+1 alpha ${'Z'.repeat(38)} tail\n 2 context`)!
  const lines = renderPreparedDiff(long, 20, theme, geometry)
  for (const line of lines) assert.ok(geometry.visibleWidth(line) <= 20)
  const removed = lines.flatMap(styledChars).filter((cell) => cell.char === 'W')
  const added = lines.flatMap(styledChars).filter((cell) => cell.char === 'Z')
  assert.equal(removed.length, 38)
  assert.equal(added.length, 38)
  assert.ok(removed.every((cell) => cell.bold && !cell.inverse && cell.bg === removed[0]!.bg))
  assert.ok(added.every((cell) => cell.bold && !cell.inverse && cell.bg === added[0]!.bg))
  const tail = lines.find((line) => geometry.stripTerminalSequences(line).includes('tail'))!
  assert.equal(stateAt(tail, 'tail').bold, false)
  assert.notEqual(stateAt(tail, 'tail').bg, removed[0]!.bg)
  const context = lines.find((line) => geometry.stripTerminalSequences(line).includes('context'))!
  assert.equal(stateAt(context, 'context').bg, 'default')
})

test('256-color and unresolved terminal defaults retain non-inverse, bounded word cues', () => {
  for (const appearance of ['dark', 'light'] as const) {
    for (const defaults of [false, true]) {
      const palette = makeTheme(appearance, '256color', { defaults })
      const lines = renderPreparedDiff(pair, 90, palette, geometry)
      for (const line of lines) assert.ok(geometry.visibleWidth(line) <= 90)
      const line = lines.find((value) => geometry.stripTerminalSequences(value).includes('alpha OLD tail'))!
      assert.ok(stateAt(line, 'OLD').bold)
      assert.ok(stateAt(line, 'NEW').bold)
      assert.equal(stateAt(line, 'tail').bold, false)
      assert.equal(stateAt(line, '│').bg, 'default')
      assert.ok(styledChars(line).every((cell) => !cell.inverse))
    }
  }
})

test('plain text, signs, wrapping, split and tiny widths match the pre-style renderer', () => {
  const unicode = prepareDiff('-1 alpha OLD tail\n+1 alpha NEW tail\n 2 ภาษาไทย 中 👩🏽‍💻')!
  assert.deepEqual(plain(renderPreparedDiff(unicode, 5, theme, geometry)), [
    '+1 −1',
    '·',
    'store',
    'd',
    'edit',
    'diff',
    'old /',
    'new ·',
    '',
    'unifi',
    'ed',
    'alpha',
    'OLD  ',
    'tail ',
    'alpha',
    'NEW  ',
    'tail ',
    'ภาษาไ',
    'ทย 中',
    '👩🏽‍💻',
  ])
  assert.deepEqual(plain(renderPreparedDiff(unicode, 20, theme, geometry)), [
    '+1 −1 · stored edit',
    'diff',
    'old / new · unified',
    '1 − alpha OLD tail  ',
    '1 + alpha NEW tail  ',
    '2/2 ภาษาไทย 中 👩🏽‍💻',
  ])
  const tiny = plain(renderPreparedDiff(unicode, 1, theme, geometry)).join('')
  assert.match(tiny, /alpha OLD tailalpha NEW tail/)
  const wide = plain(renderPreparedDiff(unicode, 90, theme, geometry))
  assert.equal(
    wide[2],
    '1 − alpha OLD tail                          │ 1 + alpha NEW tail                          ',
  )
})

test('cached edit layout repaints when the theme surface changes without other tokens changing', () => {
  let palette = makeTheme('dark', 'truecolor', { surface: '#252933' })
  const renderer = createToolPresentation('edit', {}, geometry, native, () => palette)
  const component = renderer.renderResult!(
    { content: [], details: { diff: '-1 alpha OLD tail\n+1 alpha NEW tail' } },
    { expanded: true, isPartial: false },
    theme,
    renderContext(),
  )
  const before = component.render(90)
  palette = makeTheme('dark', 'truecolor', { surface: '#303744' })
  const after = component.render(90)
  assert.deepEqual(plain(after), plain(before))
  assert.notEqual(after.join('\n'), before.join('\n'))
})
