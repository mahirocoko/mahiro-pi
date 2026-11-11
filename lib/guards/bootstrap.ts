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
  // Optional advisory failures must not prevent mandatory kernel activation.
  // Await registration so sections still precede memory/session-step overrides.
  let terraFailed = false
  try {
    const { registerTerraPersistence } = await import('../terra-persistence.ts')
    registerTerraPersistence(pi)
  } catch {
    terraFailed = true
  }
  // Kernel readiness is diagnostic, not permission to use ordinary tools.
  // Feature state operations check their own live session and ownership.
  // Inspect after every session_start handler, including PSS publication. Direct
  // extension entries can load before package extensions regardless of package order.
  pi.on('resources_discover', async (_event, ctx) => {
    if (terraFailed)
      ctx.ui.notify(
        'Terra persistence advisory unavailable; feature kernel and PSS are independent.',
        'warning',
      )
    const node = (globalThis as typeof globalThis & { [key]?: KernelRegistry })[key]?.get(
      ctx.sessionManager.getSessionId(),
    )
    if (!activationFailed && node?.healthy?.() === true) return
    let permissionsActive = false
    try {
      const { getPermissionsService } = await import('@gotgenes/pi-permission-system')
      permissionsActive = !!getPermissionsService(ctx.sessionManager.getSessionId())
    } catch {
      // Missing package/service is a different failure from kernel-only readiness.
    }
    ctx.ui.notify(
      permissionsActive
        ? 'Feature kernel unavailable: state features may be unavailable. PSS permissions remain active; ordinary tools are not blocked. Reload after checking extension diagnostics.'
        : 'Feature kernel and PSS service unavailable. Native guard tools fail closed. Check configured PSS package references and extension diagnostics before reloading.',
      'warning',
    )
  })
}
