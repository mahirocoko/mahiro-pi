import type { ExtensionAPI, ExtensionContext, Theme, ToolRenderers } from '@earendil-works/pi-coding-agent'
import {
  CLAUDE_THEME,
  createToolPresentation,
  type Geometry,
  type NativePresentation,
  type PresentationRenderers,
  renderStartupHeader,
  supportedTools,
} from '../lib/claude-ui.ts'
import {
  createSettingsPanel,
  PERSISTENCE_LIMIT,
  UI_DEFAULTS,
  type UIPreferences,
} from '../lib/claude-ui-settings.ts'
import { ownUIOwner, type UIStoredPreferences } from '../lib/claude-ui-owner.ts'
import { registerWorkflowSurface } from '../lib/workflow-hub.ts'

// Runtime presentation remains separate from explicit Root-owned Save. No native
// settings, profile provisioning, transcript, auth or model writes.
export default function mahiroClaudeUI(pi: ExtensionAPI) {
  let generation = 0
  let preferences: UIPreferences = { ...UI_DEFAULTS }
  // Not part of the closed own-UI record. Each TUI session starts stable.
  let liveTail = false
  let fixed: Theme | undefined
  let geometry: Geometry | undefined
  let native: NativePresentation | undefined
  let version = ''
  let context: ExtensionContext | undefined
  let storageStatus = PERSISTENCE_LIMIT
  let requestRender = () => {}
  const originals = new Map<string, PresentationRenderers>()
  // True when two public factory calls return the same renderer functions.
  // Shell factories allocate a new closure per call, so those use source identity.
  const factoryStable = new Map<string, boolean>()
  const sameFunction = (left: unknown, right: unknown, stable: boolean) =>
    left === right ||
    (stable === false &&
      typeof left === 'function' &&
      typeof right === 'function' &&
      left.toString() === right.toString())
  const ownedByFactory = (base: ToolRenderers, original: PresentationRenderers, stable: boolean) =>
    sameFunction(base.renderCall, original.renderCall, stable) &&
    sameFunction(base.renderResult, original.renderResult, stable) &&
    base.renderShell === original.renderShell
  const palette = (host: Theme) => (preferences.palette === 'claude' && fixed ? fixed : host)

  // Register the resolver at load time, but do not import a runtime peer or
  // activate presentation until interactive startup. Keep custom same-name
  // renderers native too: compare public factory renderer identities, not names
  // alone, private tool registry fields, or guesses from descriptions.
  // Factories that return a new closure each call still have to match that
  // factory's function source and renderShell. Codemode, subagents, MCP and
  // other custom tools are not in this map, so they stay on next().
  pi.registerToolRenderer((name, next) => {
    const base = next()
    if (!supportedTools.includes(name) || !base) return base
    let adapted: ToolRenderers | undefined
    const choose = () => {
      if (!context || !geometry || !native) return undefined
      const original = originals.get(name)
      if (!original || !ownedByFactory(base, original, factoryStable.get(name) !== false)) return undefined
      adapted ??= createToolPresentation(name, base, geometry, native, palette, () => ({
        ...preferences,
        liveTail,
      }))
      return adapted
    }
    return {
      get renderShell() {
        return choose()?.renderShell ?? base.renderShell
      },
      get renderCall() {
        return choose()?.renderCall ?? base.renderCall
      },
      get renderResult() {
        return choose()?.renderResult ?? base.renderResult
      },
    }
  })

  const installHeader = (ctx: ExtensionContext) => {
    if (!geometry) return
    const currentGeometry = geometry
    ctx.ui.setHeader((tui) => {
      requestRender = () => tui.requestRender()
      return {
        render(width) {
          // All data comes from public, read-only context/API snapshots. No
          // resource loader, settings file or filesystem access in rendering.
          const current = context ?? ctx
          return renderStartupHeader(
            {
              version,
              cwd: current.cwd,
              model: current.model ? `${current.model.provider}/${current.model.id}` : 'Model unavailable',
              effort: current.thinkingLevel ?? pi.getThinkingLevel() ?? 'unavailable',
              activeTools: pi.getActiveTools().length,
              registeredTools: pi.getAllTools().length,
              commands: pi.getCommands().length,
              mcpServers: pi.getMcpServers().length,
              paletteMode: preferences.palette,
            },
            width,
            palette(current.ui.theme),
            currentGeometry,
          )
        },
        invalidate() {},
        dispose() {
          requestRender = () => {}
        },
      }
    })
  }

  pi.on('session_start', async (_event, ctx) => {
    if (ctx.mode !== 'tui') return
    const revision = ++generation
    liveTail = false
    context = undefined
    geometry = undefined
    native = undefined
    originals.clear()
    factoryStable.clear()
    const tui = await import('@earendil-works/pi-tui')
    const sdk = await import('@earendil-works/pi-coding-agent')
    if (revision !== generation) return
    geometry = tui
    native = { renderDiff: sdk.renderDiff, keyHint: sdk.keyHint }
    version = sdk.VERSION
    // Factories only identify their public presentation functions. Never call
    // execute(), wrap tools, or register replacement definitions.
    const capture = (name: string, create: (cwd: string) => PresentationRenderers) => {
      const sample = create(ctx.cwd)
      const again = create(ctx.cwd)
      originals.set(name, sample)
      factoryStable.set(
        name,
        sample.renderCall === again.renderCall &&
          sample.renderResult === again.renderResult &&
          sample.renderShell === again.renderShell,
      )
    }
    capture('read', sdk.createReadToolDefinition)
    capture('bash', sdk.createBashToolDefinition)
    capture('powershell', sdk.createPowerShellToolDefinition)
    capture('edit', sdk.createEditToolDefinition)
    capture('write', sdk.createWriteToolDefinition)
    capture('grep', sdk.createGrepToolDefinition)
    capture('find', sdk.createFindToolDefinition)
    capture('ls', sdk.createLsToolDefinition)
    fixed = ctx.ui.getTheme(CLAUDE_THEME)
    try {
      const owner = ownUIOwner(ctx)
      if (!owner) throw Error('Unavailable')
      const stored = owner.read(ctx)
      preferences = { ...stored.preferences }
      storageStatus = 'Own-UI preferences loaded. Apply is runtime-only; only explicit Save persists changes.'
    } catch {
      storageStatus = PERSISTENCE_LIMIT
    }
    if (preferences.palette === 'claude' && !fixed) preferences = { ...preferences, palette: 'follow' }
    context = ctx
    installHeader(ctx)
  })
  pi.on('model_select', (_event, ctx) => {
    if (ctx.mode !== 'tui' || !context) return
    context = ctx
    requestRender()
  })
  pi.on('thinking_level_select', (_event, ctx) => {
    if (ctx.mode !== 'tui' || !context) return
    context = ctx
    requestRender()
  })
  pi.on('mcp_servers_change', (_event, ctx) => {
    if (ctx.mode === 'tui') requestRender()
  })
  pi.on('session_shutdown', (_event, ctx) => {
    if (ctx.mode !== 'tui') return
    generation++
    if (context && ctx.mode === 'tui') ctx.ui.setHeader(undefined)
    context = undefined
    geometry = undefined
    native = undefined
    fixed = undefined
    originals.clear()
    factoryStable.clear()
    liveTail = false
    requestRender = () => {}
  })
  const uiCommand: Parameters<ExtensionAPI['registerCommand']>[1] = {
    description:
      'Mahiro UI live preview and explicit own-UI Save; theme status | follow | claude is runtime-only',
    handler: async (args, ctx) => {
      if (ctx.mode !== 'tui' || !context) return
      const action = args.trim() || 'settings'
      if (
        action === 'live-tail' ||
        action === 'live-tail status' ||
        action === 'live-tail on' ||
        action === 'live-tail off'
      ) {
        if (action === 'live-tail on') liveTail = true
        if (action === 'live-tail off') liveTail = false
        context = ctx
        requestRender()
        ctx.ui.notify(
          `Mahiro UI live output tail: ${liveTail ? 'on' : 'off'}. Completed output stays stable unless this is on. Not saved.`,
          'info',
        )
        return
      }
      if (action === 'settings') {
        if (!geometry || !native) return
        const revision = generation
        const tui = await import('@earendil-works/pi-tui')
        if (revision !== generation || !context || !geometry || !native) return
        const panelGeometry = geometry
        const panelNative = native
        fixed = ctx.ui.getTheme(CLAUDE_THEME)
        if (preferences.palette === 'claude' && !fixed) {
          preferences = { ...preferences, palette: 'follow' }
          requestRender()
          ctx.ui.notify('Fixed UI palette unavailable; following the host theme.', 'warning')
        }
        let expected = preferences
        const current = () =>
          revision === generation && !!context && preferences === expected && !ctx.signal?.aborted
        const owner = ownUIOwner(ctx)
        let stored: UIStoredPreferences | undefined
        try {
          stored = owner?.read(ctx)
          storageStatus = stored
            ? 'Own-UI storage available. Changes are not saved until explicit Save; Apply is runtime-only.'
            : PERSISTENCE_LIMIT
        } catch {
          storageStatus = PERSISTENCE_LIMIT
        }
        await ctx.ui.custom<void>((screen, _theme, keybindings, done) =>
          createSettingsPanel({
            tui,
            geometry: panelGeometry,
            native: panelNative,
            nativeTools: new Map(originals),
            keybindings,
            theme: () => palette(ctx.ui.theme),
            initial: preferences,
            current,
            change(value) {
              if (!current() || (value.palette === 'claude' && !fixed)) return false
              preferences = { ...value }
              expected = preferences
              requestRender()
              return true
            },
            persistence: {
              status: storageStatus,
              save(value) {
                if (!current() || !owner || !stored || ownUIOwner(ctx) !== owner)
                  return {
                    saved: false,
                    message: 'Own-UI owner unavailable or stale; preferences not saved. Reopen settings.',
                  }
                try {
                  stored = owner.save(ctx, stored.ticket, value)
                  storageStatus =
                    'Own-UI preferences saved durably. Theme commands and Apply remain runtime-only.'
                  ctx.ui.notify(storageStatus, 'info')
                  return { saved: true, message: storageStatus }
                } catch (error) {
                  const code = (error as { code?: unknown })?.code
                  stored = undefined // Reopen/read after any failure; never blind retry.
                  storageStatus =
                    code === 'durability-unknown'
                      ? 'Own-UI state written, but durability is unknown. Reopen settings before any further Save.'
                      : code === 'stale'
                        ? 'Own-UI stored revision changed; preferences not saved. Reopen settings.'
                        : 'Own-UI storage unavailable; preferences not saved. Reopen settings.'
                  ctx.ui.notify(storageStatus, 'warning')
                  return { saved: false, message: storageStatus }
                }
              },
            },
            done: () => done(undefined),
            requestRender: () => screen.requestRender(),
          }),
        )
        return
      }
      if (action === 'theme claude') {
        // Public getTheme may load a resource: commands/startup only, never render.
        const candidate = ctx.ui.getTheme(CLAUDE_THEME)
        if (!candidate) {
          ctx.ui.notify(
            `Theme resource ${CLAUDE_THEME} unavailable; keeping ${preferences.palette}.`,
            'warning',
          )
          return
        }
        fixed = candidate
        preferences = { ...preferences, palette: 'claude' }
      } else if (action === 'theme follow') {
        preferences = { ...preferences, palette: 'follow' }
      } else if (action !== 'theme status' && action !== 'theme') {
        ctx.ui.notify(
          'Usage: /mh-ui [settings] | theme status|follow|claude | live-tail status|on|off',
          'warning',
        )
        return
      }
      context = ctx
      requestRender()
      ctx.ui.notify(
        `Mahiro UI palette: ${preferences.palette} · ${palette(ctx.ui.theme).name}. ` +
          (preferences.palette === 'follow'
            ? 'Follows the current Pi theme.'
            : 'Fixed Claude palette for these tool rows/header and split/unified diff; native diff still follows Pi.') +
          ` Host theme/footer unchanged. Theme commands are runtime-only; use settings → Save for authorized persistence. ${storageStatus}`,
        'info',
      )
    },
  }
  pi.registerCommand('mh-ui', uiCommand)
  registerWorkflowSurface(pi, {
    id: 'appearance',
    label: 'Appearance settings',
    open: (ctx) => uiCommand.handler('settings', ctx),
  })
}
