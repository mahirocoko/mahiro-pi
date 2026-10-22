import type { ExtensionContext, ToolInfo } from '@earendil-works/pi-coding-agent'
import type { SubagentsService } from '@gotgenes/pi-subagents'
import type { MemoryABI } from '../agent-memory/runtime.ts'
import type { IGuardNode } from '../continuity/runtime.ts'
import type { OwnUIOwner } from '../claude-ui-owner.ts'
import type { createGuardHost } from './host.mjs'

type Operation = 'read' | 'write'
type Tool = ToolInfo | undefined
interface StateABI {
  version: number
  generation: object
  assertAccess(tool: Tool, ctx: ExtensionContext, root: string, operation?: Operation): void
  authorize(
    tool: Tool,
    ctx: ExtensionContext,
    root: string,
    operation?: Operation,
    signal?: AbortSignal,
  ): Promise<void>
}
interface EvidenceABI extends StateABI {
  assertSources(tool: Tool, ctx: ExtensionContext, root: string, operation: Operation, paths: string[]): void
  authorizeGit(
    tool: Tool,
    ctx: ExtensionContext,
    root: string,
    operation: Operation,
    executable: string,
    args: string[],
    signal?: AbortSignal,
  ): Promise<void>
}
export interface GuardNode {
  generation: object
  healthy(): boolean
  host: ReturnType<typeof createGuardHost>
  ownUI: OwnUIOwner
  codeMap: Pick<StateABI, 'version' | 'generation'> & {
    assertAccess(tool: Tool, ctx: ExtensionContext): void
  }
  goal: StateABI
  uxWorkflow: StateABI
  executionRun: StateABI
  evidence: EvidenceABI
  managedMemory: MemoryABI & { permission(root: string): string }
  continuity: IGuardNode['continuity'] & { learningPermission(root: string): string }
}
interface MemoryLease {
  ownerId: string
  generation: object
  root: string
  jobId: string
  service: SubagentsService
  value: Parameters<MemoryABI['bindWorker']>[4]
  active(): boolean
}
export type GuardRegistry = Map<string, GuardNode> & {
  nativeChildren?: Set<string>
  nativeParents?: Map<string, string>
  memoryLeases?: Map<string, MemoryLease>
}
