import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
  ThemeBg,
  ThemeColor,
} from '@earendil-works/pi-coding-agent'
import type { Component, Terminal } from '@earendil-works/pi-tui'
import { registerSessionTasks } from '../lib/session-work/tasks.ts'
import { registerSessionQueue } from '../lib/session-work/queue.ts'

/** Real public SDK/Faux; scripted public UI is not a native terminal or human acceptance. */
export async function sessionWorkFixture(options: { memory?: boolean } = {}) {
  const sdk = await import('@earendil-works/pi-coding-agent')
  const ai = await import('@earendil-works/pi-ai')
  const tui = await import('@earendil-works/pi-tui')
  const base = resolve('.agent-state/runtime')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'session-work-'))
  const cwd = join(dir, 'project'),
    agentDir = join(dir, 'agent')
  mkdirSync(cwd)
  mkdirSync(agentDir)
  const foreground = Object.fromEntries(
    [
      'accent',
      'border',
      'borderAccent',
      'borderMuted',
      'success',
      'error',
      'warning',
      'muted',
      'dim',
      'text',
      'thinkingText',
      'scrollbarTrack',
      'scrollbarThumb',
      'searchMatchText',
      'userMessageText',
      'customMessageText',
      'customMessageLabel',
      'toolTitle',
      'toolOutput',
      'mdHeading',
      'mdLink',
      'mdLinkUrl',
      'mdCode',
      'mdCodeBlock',
      'mdCodeBlockBorder',
      'mdQuote',
      'mdQuoteBorder',
      'mdHr',
      'mdListBullet',
      'toolDiffAdded',
      'toolDiffRemoved',
      'toolDiffContext',
      'syntaxComment',
      'syntaxKeyword',
      'syntaxFunction',
      'syntaxVariable',
      'syntaxString',
      'syntaxNumber',
      'syntaxType',
      'syntaxOperator',
      'syntaxPunctuation',
      'thinkingOff',
      'thinkingMinimal',
      'thinkingLow',
      'thinkingMedium',
      'thinkingHigh',
      'thinkingXhigh',
      'thinkingMax',
      'bashMode',
    ].map((key) => [key, '#dddddd']),
  ) as Record<ThemeColor, string>
  const background = Object.fromEntries(
    [
      'selectedBg',
      'searchMatchBg',
      'userMessageBg',
      'customMessageBg',
      'toolPendingBg',
      'toolSuccessBg',
      'toolErrorBg',
    ].map((key) => [key, '#222222']),
  ) as Record<ThemeBg, string>
  const theme = new sdk.Theme(foreground, background, 'truecolor')
  const terminal: Terminal = {
    columns: 80,
    rows: 24,
    kittyProtocolActive: false,
    start() {},
    stop() {},
    async drainInput() {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    setProgramStatus() {},
  }
  const screen = new tui.TuiMainScreen(terminal)
  // SIMULATED HOST UI: real public Editor; no native CLI/private composer access.
  const composerEditor = new tui.Editor(screen, {
    borderColor: (value) => value,
    selectList: {
      selectedPrefix: (value) => value,
      selectedText: (value) => value,
      description: (value) => value,
      scrollInfo: (value) => value,
      noMatch: (value) => value,
    },
  })
  screen.addChild(composerEditor)
  screen.setFocus(composerEditor)
  const customCloses: Array<'overlay-hide' | 'restore-setText'> = []
  const widgets = new Map<string, Component>()
  const choices: Array<string | undefined> = [],
    inputs: Array<string | undefined> = []
  const modalKeys: string[][] = []
  type UIHold = {
    kind: 'select' | 'editor' | 'input'
    choice?: string
    entered(): void
    released: Promise<void>
  }
  let uiHold: UIHold | undefined
  function holdUI(kind: UIHold['kind'], choice?: string) {
    assert.equal(uiHold, undefined, 'Only one deferred UI boundary per fixture')
    let entered = () => {},
      release = () => {}
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    uiHold = { kind, choice, entered, released }
    return { entered: ready, release }
  }
  async function waitAtUI(kind: UIHold['kind'], choice?: string) {
    const hold = uiHold
    if (!hold || hold.kind !== kind || (hold.choice !== undefined && hold.choice !== choice)) return
    uiHold = undefined
    hold.entered()
    await hold.released
  }
  const notices: string[] = [],
    errors: unknown[] = []
  let confirmationCalls = 0,
    composerTouches = 0,
    confirms = true,
    factories = 0,
    failAppend = false
  const composer = {
    text: 'untouched native draft ภาษาไทย',
    images: [{ type: 'image', data: 'ZHJhZnQ=', mimeType: 'image/png' }],
    caret: { line: 0, col: 4 },
  }
  const ui: ExtensionUIContext = {
    theme,
    async select(_title, options) {
      assert.ok(choices.length, `Unscripted selector: ${options.join(', ')}`)
      const choice = choices.shift()
      if (choice === undefined) return undefined
      const found = options.find((s) => s === choice || s.startsWith(choice))
      assert.ok(found, `Missing selection ${choice}: ${options.join(', ')}`)
      await waitAtUI('select', choice)
      return found
    },
    async input() {
      const value = inputs.shift()
      await waitAtUI('input', value)
      return value
    },
    async confirm() {
      confirmationCalls++
      return confirms
    },
    notify(message) {
      notices.push(message)
    },
    setWidget(key, content) {
      if (content === undefined) widgets.delete(key)
      else
        widgets.set(
          key,
          typeof content === 'function' ? content(screen, theme) : { render: () => content, invalidate() {} },
        )
    },
    async custom<T>(
      factory: Parameters<ExtensionUIContext['custom']>[0],
      options?: Parameters<ExtensionUIContext['custom']>[1],
    ): Promise<T> {
      // Public host 1.3/1.4 showExtensionCustom semantics: only non-overlay close
      // restores text with setText (which resets a real Editor's insertion point).
      const savedText = composerEditor.getText()
      let overlay: ReturnType<typeof screen.showOverlay> | undefined
      const keys = modalKeys.shift()
      assert.ok(keys, 'Unscripted modal')
      let resolved = false
      const result = await new Promise<unknown>(async (done, reject) => {
        try {
          const component = await factory(
            screen,
            theme,
            // Product modal uses no app-only keybinding APIs; this scripted UI supplies public TUI keys.
            // Native CLI keybinding/composer acceptance remains a separate Main-owned gate.
            tui.getKeybindings() as Parameters<Parameters<ExtensionUIContext['custom']>[0]>[2],
            (value) => {
              if (resolved) return
              resolved = true
              if (options?.overlay) {
                overlay?.hide()
                customCloses.push('overlay-hide')
              } else {
                composerEditor.setText(savedText)
                screen.setFocus(composerEditor)
                customCloses.push('restore-setText')
              }
              done(value)
            },
          )
          if (options?.overlay)
            overlay = screen.showOverlay(
              component,
              typeof options.overlayOptions === 'function'
                ? options.overlayOptions()
                : options.overlayOptions,
            )
          else screen.setFocus(component)
          for (const width of [24, 48, 80, 120])
            for (const line of component.render(width)) assert.ok(tui.visibleWidth(line) <= width)
          await waitAtUI('editor')
          for (const key of keys) component.handleInput?.(key)
          assert.ok(resolved, 'Modal did not save/cancel')
        } catch (error) {
          reject(error)
        }
      })
      return result as T
    },
    onTerminalInput() {
      return () => {}
    },
    setStatus() {},
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setFooter() {
      throw new Error('Footer ownership violation')
    },
    setHeader() {
      throw new Error('Header ownership violation')
    },
    setTitle() {},
    pasteToEditor() {
      composerTouches++
    },
    setEditorText() {
      composerTouches++
    },
    getEditorText() {
      composerTouches++
      return composer.text
    },
    async editor() {
      throw new Error('Use isolated custom editor')
    },
    addAutocompleteProvider() {},
    setEditorComponent() {
      composerTouches++
    },
    getEditorComponent() {
      return undefined
    },
    getAllThemes() {
      return []
    },
    getTheme() {
      return theme
    },
    setTheme() {
      throw new Error('Theme ownership violation')
    },
    getToolsExpanded() {
      return false
    },
    setToolsExpanded() {},
  }
  let context: ExtensionContext | undefined, api: ExtensionAPI | undefined
  let queue: ReturnType<typeof registerSessionQueue> | undefined
  const faux = ai.fauxProvider({
    provider: `session-work-${crypto.randomUUID()}`,
    models: [{ id: 'fixture' }],
  })
  const modelRuntime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  const createRuntime: Parameters<typeof sdk.createAgentSessionRuntime>[0] = async ({
    sessionManager,
    sessionStartEvent,
  }) => {
    const settingsManager = sdk.SettingsManager.inMemory({
      defaultTools: [],
      cacheWarming: 'off',
      compaction: { enabled: false },
      retry: { enabled: false },
      enableInstallTelemetry: false,
    })
    const services = await sdk.createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      settingsManager,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noContextFiles: true,
        noThemes: true,
        noPromptTemplates: true,
        disabledBuiltinExtensions: ['mcp', 'codemode', 'tool-search', 'llama.cpp'],
        systemPrompt: 'Deterministic offline session-work functional fixture.',
        extensionFactories: [
          (pi) => {
            factories++
            api = pi
            const append = pi.appendEntry.bind(pi)
            pi.appendEntry = (type, data) => {
              if (failAppend) throw new Error('Fixture storage unavailable')
              append(type, data)
            }
            registerSessionTasks(pi)
            queue = registerSessionQueue(pi)
            pi.on('session_start', (_event, ctx) => {
              context = ctx
            })
          },
        ],
      },
    })
    assert.deepEqual(services.resourceLoader.getExtensions().errors, [])
    const result = await sdk.createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model: faux.getModel(),
      thinkingLevel: 'off',
      noTools: 'builtin',
    })
    await result.session.bindExtensions({
      mode: 'tui',
      uiContext: ui,
      onError: (error) => {
        errors.push(error)
      },
    })
    return { ...result, services, diagnostics: services.diagnostics }
  }
  const runtime = await sdk.createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: options.memory
      ? sdk.SessionManager.inMemory(cwd)
      : sdk.SessionManager.create(cwd, join(dir, 'sessions')),
  })
  const current = () => {
    assert.ok(context && api && queue)
    return { ctx: context, pi: api, queue }
  }
  async function invoke(name: string, args: Parameters<typeof ai.fauxToolCall>[1] = {}, expectError = false) {
    faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxToolCall(name, args)], { stopReason: 'toolUse' }),
      ai.fauxAssistantMessage('Fixture turn complete.'),
    ])
    await runtime.session.prompt(`Invoke ${name}`)
    const entry = runtime.session.sessionManager
      .getBranch()
      .filter((e) => e.type === 'message' && e.message.role === 'toolResult')
      .at(-1)
    assert.ok(entry?.type === 'message' && entry.message.role === 'toolResult')
    assert.equal(entry.message.isError, expectError)
    if (expectError) return { error: entry.message.content }
    return JSON.parse(
      entry.message.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n'),
    ) as Record<string, unknown>
  }
  async function textTurn(text = 'ordinary fixture text') {
    faux.setResponses([ai.fauxAssistantMessage('ordinary fixture response')])
    await runtime.session.prompt(text)
  }
  async function command(name: string, selections: Array<string | undefined>) {
    choices.push(...selections)
    await runtime.session.prompt(`/${name}`)
    assert.equal(choices.length, 0)
  }
  return {
    sdk,
    ai,
    tui,
    runtime,
    faux,
    current,
    invoke,
    textTurn,
    command,
    ui,
    widgets,
    inputs,
    modalKeys,
    holdUI,
    notices,
    errors,
    composer,
    composerEditor,
    customCloses,
    terminal,
    get confirmationCalls() {
      return confirmationCalls
    },
    get composerTouches() {
      return composerTouches
    },
    get factories() {
      return factories
    },
    set failAppend(value: boolean) {
      failAppend = value
    },
    set confirms(value: boolean) {
      confirms = value
    },
    async dispose() {
      try {
        // Public runtime.dispose emits session_shutdown before session disposal.
        await runtime.dispose()
      } finally {
        screen.stop()
        rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}
