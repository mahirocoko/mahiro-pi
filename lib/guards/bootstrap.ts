import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { KernelRegistry } from '../kernel/types.ts'
import activateKernel from '../kernel/index.ts'

// The first existing manifest entry starts the feature lifecycle independently
// of optional Root enforcement. Loading/startup still provisions no state.
export default async function bootstrap(pi: ExtensionAPI) {
  const key = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
  let activationFailed = false
  try {
    await activateKernel(pi)
  } catch {
    activationFailed = true
  }
  // Kernel readiness is diagnostic, not permission to use ordinary tools.
  // Feature state operations check their own live session and ownership.
  pi.on('session_start', (_event, ctx) => {
    const node = (globalThis as typeof globalThis & { [key]?: KernelRegistry })[key]?.get(
      ctx.sessionManager.getSessionId(),
    )
    if (!activationFailed && node?.healthy?.() === true) return
    ctx.ui.notify(
      'Feature kernel unavailable: state features may be unavailable. PSS permissions remain active; ordinary tools are not blocked. Reload after checking extension diagnostics.',
      'warning',
    )
  })
}
