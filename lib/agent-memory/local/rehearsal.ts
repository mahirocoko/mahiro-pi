import { lstat, readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { digest } from '../../continuity/records.ts'
import { type Ledger } from '../engine/schema.ts'
import { canonicalLedgerDigest, migrationExportSections, pageMigrationExport } from '../migration-export.ts'
import { readRegularFile } from './confine.ts'
import { assertExactDirectory } from './contracts.ts'
import { localMemoryClaimPath } from './coordination.ts'
import {
  inspectShadowQuarantine,
  openShadowMigrationUnderClaim,
  rollbackShadowMigrationUnderClaim,
  shadowMigrationReview,
  shadowMigrationTurn,
  type ShadowMigrationBundle,
} from './migration.ts'
import {
  appendRehearsalEvent,
  newRehearsalRecord,
  readRehearsalRecord,
  rehearsalFixture,
  rehearsalLimits,
  rehearsalState,
  saveRehearsalRecord,
  type RehearsalPlan,
  type RehearsalRecord,
  type RehearsalQuarantineIdentity,
} from './rehearsal-receipt.ts'

export interface RehearsalRequest {
  command: 'preview' | 'apply' | 'status' | 'rollback'
  target: string
  fixture: typeof rehearsalFixture
  operation?: string
  expect?: string
}
export interface RehearsalResult {
  disposition: 'previewed' | 'shadow-verified' | 'quarantined' | 'refused' | 'unknown'
  reason: 'recorded' | 'identity' | 'expectation' | 'order' | 'interrupted' | 'unavailable' | 'capacity'
  record?: RehearsalRecord
  quarantineId?: string
}
// Synthetic source-test fault points only; not exposed by the CLI.
export interface RehearsalInjection {
  stopAfter?: 'applying' | 'shadow' | 'quarantining' | 'renamed'
}

// No source/root/bundle/provider inputs. This authored bundle is the only corpus.
function fixedBundle(): ShadowMigrationBundle {
  const revision = '6'.repeat(40)
  const configHash = digest('r6-basic-v1 synthetic configuration')
  const texts = {
    'Core.md': '# Synthetic rehearsal\nDisconnected fixture only.\n',
    'global/forgotten.md': 'Synthetic excluded example.\n',
    'index.md': '# Synthetic index\nNo private knowledge.\n',
  }
  const files = Object.entries(texts).map(([path, text]) => {
    const hash = digest(text)
    return {
      path,
      text,
      hash,
      sources: [],
      read: {
        revision,
        currentRevision: revision,
        basis: 'view-snapshot' as const,
        freshness: 'current' as const,
        path,
        hash,
        sources: [],
      },
    }
  })
  const ledger: Ledger = {
    version: 2,
    sources: { 'Core.md': [], 'index.md': [] },
    forgottenPaths: ['global/forgotten.md'],
    forgottenSources: [],
    reviewed: [],
  }
  const ledgerDigest = canonicalLedgerDigest(`${JSON.stringify(ledger)}\n`)
  const pages = migrationExportSections.map((section) =>
    pageMigrationExport({
      revision,
      configHash,
      ledgerDigest,
      ledger,
      section,
      offset: 0,
      limit: 32,
      contentHashes: Object.fromEntries(files.map((file) => [file.path, file.hash])),
    }),
  )
  return {
    revision,
    configHash,
    ledgerDigest,
    files,
    pages,
    forgottenPaths: ledger.forgottenPaths,
    forgottenSources: [],
    reviewed: [],
  }
}

export async function runMemoryRehearsal(
  request: RehearsalRequest,
  injection?: RehearsalInjection,
): Promise<RehearsalResult> {
  let observed: RehearsalRecord | undefined
  try {
    validateRequest(request)
    const { target, parent, recordPath } = await location(request.target)
    // Terminal replay revalidates the exact moved identity; never infer success from
    // a missing original target or adopt/reconcile a replacement quarantine.
    const prior = await readRehearsalRecord(recordPath)
    observed = prior
    if (prior && rehearsalState(prior) === 'quarantined') {
      if (await present(localMemoryClaimPath(target))) return result('unknown', 'unavailable', prior)
      if (request.command === 'status' || request.command === 'rollback') {
        if (request.command === 'rollback' && !matches(request, prior))
          return result('refused', 'expectation', prior)
        const directory = await lstat(parent)
        if (
          prior.plan.targetHash !== digest(target) ||
          prior.plan.parentDev !== String(directory.dev) ||
          prior.plan.parentIno !== String(directory.ino)
        )
          return result('refused', 'identity', prior)
        const identity = prior.events.find((event) => event.kind === 'quarantined')!
          .evidence as RehearsalQuarantineIdentity
        const quarantine = `${target}.quarantine-${identity.suffix}`
        if (await present(localMemoryClaimPath(quarantine))) return result('unknown', 'unavailable', prior)
        const current = await inspectShadowQuarantine(quarantine, target)
        if (!isDeepStrictEqual(current, identity)) return result('unknown', 'identity', prior)
        return { ...result('quarantined', 'recorded', prior), quarantineId: identity.suffix }
      }
      return result('refused', 'order', prior)
    }
    return await shadowMigrationTurn(target, async (claim) => {
      let record = await readRehearsalRecord(recordPath)
      const bundle = fixedBundle()
      const plan = await currentPlan(target, parent, bundle)
      if (record && !isDeepStrictEqual(record.plan, plan))
        return attempt(recordPath, record, request, 'refused', 'identity')
      if (request.command === 'preview') {
        if (record) {
          if (rehearsalState(record) !== 'previewed') return result('refused', 'order', record)
          if ((await readdir(target)).length !== 0) return result('refused', 'identity', record)
          return result('previewed', 'recorded', record)
        }
        const names = await readdir(parent)
        if (
          names.sort().join() !== ['shadow', 'shadow.operation-claim'].sort().join() ||
          (await readdir(target)).length !== 0
        )
          return result('refused', 'identity')
        record = newRehearsalRecord(plan)
        claim.verify()
        await saveRehearsalRecord(recordPath, record)
        return result('previewed', 'recorded', record)
      }
      if (!record) return result('refused', 'unavailable')
      const state = rehearsalState(record)
      if (request.command === 'status') {
        if (state === 'applying' || state === 'quarantining') return result('unknown', 'interrupted', record)
        if (state === 'shadow-verified' && !(await migrationAgrees(target, record)))
          return result('unknown', 'identity', record)
        return result(state as 'previewed' | 'shadow-verified', 'recorded', record)
      }
      if (!matches(request, record)) return attempt(recordPath, record, request, 'refused', 'expectation')
      if (state === 'applying' || state === 'quarantining')
        return attempt(recordPath, record, request, 'unknown', 'interrupted')
      if (request.command === 'apply' && state === 'shadow-verified') {
        if (!(await migrationAgrees(target, record)))
          return attempt(recordPath, record, request, 'unknown', 'identity')
        return result('shadow-verified', 'recorded', record)
      }
      if (
        (request.command === 'apply' && state !== 'previewed') ||
        (request.command === 'rollback' && state !== 'shadow-verified')
      )
        return attempt(recordPath, record, request, 'refused', 'order')
      // Reserve intent, terminal and one unknown event before admitting mutation.
      if (record.events.length > rehearsalLimits.maxEvents - 3) return result('refused', 'capacity', record)
      if (request.command === 'apply' && (await readdir(target)).length !== 0)
        return attempt(recordPath, record, request, 'refused', 'identity')
      if (request.command === 'rollback' && !(await migrationAgrees(target, record)))
        return attempt(recordPath, record, request, 'refused', 'identity')
      const action = request.command
      record = appendRehearsalEvent(record, action, action === 'apply' ? 'applying' : 'quarantining')
      await saveRehearsalRecord(recordPath, record)
      observed = record
      let terminal: RehearsalRecord
      let quarantineId: string | undefined
      try {
        stop(injection, action === 'apply' ? 'applying' : 'quarantining')
        if (action === 'apply') {
          const shadow = await openShadowMigrationUnderClaim(
            { stateRoot: target, bundle, worker: () => {} },
            claim,
          )
          stop(injection, 'shadow')
          terminal = appendRehearsalEvent(
            record,
            action,
            'shadow-verified',
            digest(JSON.stringify(shadow.receipt)),
          )
        } else {
          const moved = await rollbackShadowMigrationUnderClaim(target, claim)
          stop(injection, 'renamed')
          const identity = await inspectShadowQuarantine(moved.quarantined, target)
          claim.verify()
          terminal = appendRehearsalEvent(record, action, 'quarantined', identity)
          quarantineId = identity.suffix
        }
      } catch {
        // Do not retry mutations from an intent or guess whether a rename/publication succeeded.
        return attempt(recordPath, record, request, 'unknown', 'interrupted')
      }
      // A failed terminal write/read-back must never overwrite possibly persisted terminal truth.
      await saveRehearsalRecord(recordPath, terminal)
      observed = terminal
      return {
        ...result(action === 'apply' ? 'shadow-verified' : 'quarantined', 'recorded', terminal),
        ...(quarantineId ? { quarantineId } : {}),
      }
    })
  } catch {
    // Includes retained/poisoned claims, malformed records and missing original targets.
    // Never copy exception text (or assert a durable refusal when a claim was unavailable).
    return result('unknown', 'unavailable', observed)
  }
}

async function attempt(
  path: string,
  record: RehearsalRecord,
  request: RehearsalRequest,
  disposition: 'refused' | 'unknown',
  reason: RehearsalResult['reason'],
): Promise<RehearsalResult> {
  if (request.command === 'status' || request.command === 'preview')
    return result(disposition, reason, record)
  const last = record.events.at(-1)!
  // Deduplicate exact dispositions; untrusted supplied operation/token text is never persisted.
  if (last.kind !== disposition || last.action !== request.command) {
    if (record.events.length >= rehearsalLimits.maxEvents) return result(disposition, 'capacity', record)
    record = appendRehearsalEvent(record, request.command, disposition)
    await saveRehearsalRecord(path, record)
  }
  return result(disposition, reason, record)
}

async function migrationAgrees(target: string, record: RehearsalRecord) {
  const event = record.events.find((entry) => entry.kind === 'shadow-verified')
  const receipt = JSON.parse((await readRegularFile(join(target, 'migration.json'))).text)
  return event?.evidence === digest(JSON.stringify(receipt))
}

async function location(target: string) {
  const parent = dirname(target)
  if (basename(target) !== 'shadow' || !/^mahiro-memory-rehearsal-[a-f0-9]{16}$/.test(basename(parent)))
    throw Error('Rehearsal disposable target required')
  await assertExactDirectory(parent)
  return { target, parent, recordPath: join(parent, 'rehearsal.json') }
}
async function currentPlan(
  target: string,
  parent: string,
  bundle: ShadowMigrationBundle,
): Promise<RehearsalPlan> {
  const root = await lstat(target)
  const directory = await lstat(parent)
  return {
    targetHash: digest(target),
    parentDev: String(directory.dev),
    parentIno: String(directory.ino),
    dev: String(root.dev),
    ino: String(root.ino),
    fixtureDigest: digest(JSON.stringify(shadowMigrationReview(bundle))),
  }
}
function matches(request: RehearsalRequest, record: RehearsalRecord) {
  return request.operation === record.operation && request.expect === record.expect
}
function validateRequest(request: RehearsalRequest) {
  const mutation = request.command === 'apply' || request.command === 'rollback'
  if (
    Object.keys(request).sort().join() !==
      (mutation ? 'command,expect,fixture,operation,target' : 'command,fixture,target') ||
    !['preview', 'apply', 'status', 'rollback'].includes(request.command) ||
    request.fixture !== rehearsalFixture ||
    typeof request.target !== 'string' ||
    (mutation &&
      (typeof request.operation !== 'string' ||
        !/^[a-f0-9]{32}$/.test(request.operation) ||
        typeof request.expect !== 'string' ||
        !/^[a-f0-9]{64}$/.test(request.expect)))
  )
    throw Error('Rehearsal request refused')
}
async function present(path: string) {
  return lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false
      throw error
    },
  )
}
function stop(
  injection: RehearsalInjection | undefined,
  point: NonNullable<RehearsalInjection['stopAfter']>,
) {
  if (injection?.stopAfter === point) throw Error('Synthetic rehearsal interruption')
}
function result(
  disposition: RehearsalResult['disposition'],
  reason: RehearsalResult['reason'],
  record?: RehearsalRecord,
): RehearsalResult {
  return { disposition, reason, ...(record ? { record } : {}) }
}
