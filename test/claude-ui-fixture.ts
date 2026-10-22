// Deterministic public-TUI render fixture, not a live Pi/profile probe.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  initTheme,
  keyHint,
  renderDiff,
  Theme,
} from '@earendil-works/pi-coding-agent'
import * as geometry from '@earendil-works/pi-tui'
import {
  createToolPresentation,
  renderStartupHeader,
  type ToolRenderContext,
  type PresentationRenderers,
} from '../lib/claude-ui.ts'

// Built-in palette, watcher disabled, only inside this isolated test process.
initTheme('dark', false)
// Deliberately non-default fixture binding proves hints use the public manager.
geometry.setKeybindings(
  new geometry.KeybindingsManager({
    ...geometry.TUI_KEYBINDINGS,
    'app.tools.expand': { defaultKeys: 'f6', description: 'Fixture expansion' },
  }),
)

export { geometry }
export const themeFrom = (name = 'mahiro-claude-dark') => {
  const json = JSON.parse(readFileSync(new URL('../themes/mahiro-claude-dark.json', import.meta.url), 'utf8'))
  const resolve = (value: string | number): string | number =>
    typeof value === 'string' && json.vars[value] ? resolve(json.vars[value]) : value
  const colors = Object.fromEntries(
    Object.entries(json.colors).map(([key, value]) => [key, resolve(value as string)]),
  )
  return new Theme(colors as never, colors as never, 'truecolor', {
    name,
    appearance: 'dark',
  })
}
export const theme = themeFrom()
export const native = { renderDiff, keyHint }
export const nativeTools = new Map<string, PresentationRenderers>([
  ['read', createReadToolDefinition('/fixture')],
  ['bash', createBashToolDefinition('/fixture')],
  ['edit', createEditToolDefinition('/fixture')],
  ['write', createWriteToolDefinition('/fixture')],
])
export function renderContext(overrides: Partial<ToolRenderContext> = {}): ToolRenderContext {
  return {
    args: { path: 'src/ทดสอบ.ts' },
    toolCallId: 'fixture-call',
    invalidate() {},
    lastComponent: undefined,
    state: {},
    cwd: '/fixture/project',
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: false,
    durationMs: 20,
    outputPad: 1,
    ...overrides,
  }
}
export function fixture(width: number): string[] {
  const lines = renderStartupHeader(
    {
      version: '1.3.0',
      model: 'openai/gpt-fixture',
      effort: 'low',
      cwd: '/fixture/ภาษาไทย/👩🏽‍💻',
      activeTools: 4,
      registeredTools: 8,
      commands: 3,
      mcpServers: 0,
      paletteMode: 'follow',
    },
    width,
    theme,
    geometry,
  )
  const samples = [
    {
      name: 'read',
      args: { path: 'src/ทดสอบ.ts' },
      content: 'first line\nภาษาไทย 👩🏽‍💻 é\nthird line\nfourth',
      details: undefined,
    },
    {
      name: 'bash',
      args: { command: 'pnpm test' },
      content: 'test output so far',
      details: undefined,
      partial: true,
    },
    {
      name: 'bash',
      args: { command: 'false' },
      content: 'Command exited with code 1',
      details: undefined,
      error: true,
    },
    {
      name: 'edit',
      args: { path: 'src/ทดสอบ.ts' },
      content: 'Successfully replaced 2 blocks.',
      details: {
        diff: " 1 const title = 'hello';\n-2 old value\n+2 ภาษาไทย 👩🏽‍💻\n 3 unchanged",
      },
    },
    {
      name: 'write',
      args: {
        path: 'notes.md',
        content: '# Notes\n\nTruthful submitted content\n',
      },
      content: 'Successfully wrote notes.md',
      details: undefined,
    },
  ]
  for (const sample of samples) {
    const renderer = createToolPresentation(
      sample.name,
      createReadToolDefinition('/fixture'),
      geometry,
      native,
      (host) => host,
    )
    const ctx = renderContext({
      args: sample.args,
      isPartial: sample.partial ?? false,
      isError: sample.error ?? false,
    })
    lines.push('', ...renderer.renderCall!(ctx.args, theme, ctx).render(width))
    lines.push(
      ...renderer.renderResult!(
        {
          content: [{ type: 'text', text: sample.content }],
          details: sample.details,
        },
        { expanded: false, isPartial: ctx.isPartial },
        theme,
        ctx,
      ).render(width),
    )
  }
  return lines
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const width = Number(process.argv[2] ?? '110')
  const lines = fixture(width)
  console.log(
    (process.argv.includes('--plain') ? lines.map(geometry.stripTerminalSequences) : lines).join('\n'),
  )
}
