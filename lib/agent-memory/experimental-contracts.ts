import type { ExtensionContext, ToolInfo } from '@earendil-works/pi-coding-agent'
import type { MemoryABI } from './runtime.ts'
import type { MemoryEngineController } from './engine/controller.ts'

// Opaque by-reference data only. Root never authenticates a serialized view/controller claim.
export interface EngineWorkerValue {
  version: 2
  engine: MemoryEngineController
  root: string
  project: string
  view: string
  base: string
  configHash: string
  deadline: number
  ready: boolean
  dataBarrier(): Promise<void>
}
export interface MemoryABIV2
  extends Omit<MemoryABI, 'version' | 'assertAccess' | 'authorize' | 'bindWorker'> {
  version: 2
  root: string
  live: () => boolean
  hold(owner: object): () => void
  onRetire(callback: () => Promise<void>): () => void
  maintenanceAccess(
    tool: ToolInfo,
    ctx: ExtensionContext,
    root: string,
    operation: 'read' | 'write',
    targets: readonly string[],
  ): EngineAccess
  assertTargets(
    tool: ToolInfo,
    ctx: ExtensionContext,
    root: string,
    operation: 'read' | 'write',
    targets: readonly string[],
  ): EngineAccess
  assertAccess(
    tool: ToolInfo,
    ctx: ExtensionContext,
    root: string,
    operation: 'read' | 'write',
    target?: string,
  ): EngineAccess
  authorize(
    tool: ToolInfo,
    ctx: ExtensionContext,
    root: string,
    operation: 'read' | 'write',
    signal?: AbortSignal,
  ): Promise<EngineAccess>
  bindWorker(
    tool: ToolInfo,
    ctx: ExtensionContext,
    root: string,
    id: string,
    value: EngineWorkerValue,
    identityLive: () => boolean,
  ): () => void
}
export type EngineAccess = { kind: 'primary' } | { kind: 'worker'; value: EngineWorkerValue }
export type ManagedMemoryABI = MemoryABI | MemoryABIV2

type LegacyValue = Parameters<MemoryABI['bindWorker']>[4]
type Access = ReturnType<MemoryABI['assertAccess']> | EngineAccess
type Common = Omit<MemoryABI, 'version' | 'assertAccess' | 'authorize' | 'bindWorker'> & {
  permission(root: string): string
  assertAccess(
    tool: ToolInfo,
    ctx: ExtensionContext,
    root: string,
    operation: 'read' | 'write',
    target?: string,
  ): Access
  authorize(
    tool: ToolInfo,
    ctx: ExtensionContext,
    root: string,
    operation: 'read' | 'write',
    signal?: AbortSignal,
  ): Promise<Access>
  bindWorker(
    tool: ToolInfo,
    ctx: ExtensionContext,
    root: string,
    id: string,
    value: LegacyValue | EngineWorkerValue,
    identityLive: () => boolean,
  ): () => void
}
export function buildManagedMemoryABI(
  selection:
    | {
        root: string
        live: () => boolean
        hold(owner: object): () => void
        onRetire(callback: () => Promise<void>): () => void
        assertTargets: MemoryABIV2['assertTargets']
        maintenanceAccess: MemoryABIV2['maintenanceAccess']
      }
    | undefined,
  common: Common,
): ManagedMemoryABI & { permission(root: string): string } {
  const isEngine = (value: LegacyValue | EngineWorkerValue): value is EngineWorkerValue =>
    'version' in value && value.version === 2
  const legacy = (access: Access): ReturnType<MemoryABI['assertAccess']> => {
    if (access.kind === 'primary') return access
    if (!access.value || isEngine(access.value)) throw Error('Managed memory ABI mismatch')
    return { kind: 'worker', value: access.value }
  }
  const engine = (access: Access): EngineAccess => {
    if (access.kind === 'primary') return { kind: 'primary' }
    if (!access.value || !isEngine(access.value)) throw Error('Managed memory ABI mismatch')
    return { kind: 'worker', value: access.value }
  }
  if (!selection)
    return {
      ...common,
      version: 1,
      assertAccess: (...args) => legacy(common.assertAccess(...args)),
      authorize: async (...args) => legacy(await common.authorize(...args)),
    }
  return {
    ...common,
    version: 2,
    root: selection.root,
    live: selection.live,
    hold: selection.hold,
    onRetire: selection.onRetire,
    assertTargets: selection.assertTargets,
    maintenanceAccess: selection.maintenanceAccess,
    assertAccess: (...args) => engine(common.assertAccess(...args)),
    authorize: async (...args) => engine(await common.authorize(...args)),
  }
}
