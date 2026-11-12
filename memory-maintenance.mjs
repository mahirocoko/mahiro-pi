#!/usr/bin/env node
// Explicit operator entry only. No installation, provisioning, inference, session control or repair FS here.
import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBootstrapFile } from './lib/bootstrap.ts'

let resetting = false
let resetApply = false
let stage = 'arguments'
const code = 'operator-refused'
let nativeDiagnostic
try {
  const args = process.argv.slice(2)
  resetting = args.includes('--reset')
  resetApply = resetting && args.includes('--apply')
  const options = {}
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (
      ![
        '--agent-dir',
        '--project',
        '--inspect',
        '--apply',
        '--resume',
        '--rollback',
        '--drafts',
        '--episodes',
        '--park-open',
        '--restore',
        '--reset',
        '--destroy-no-backup',
        '--offline',
        '--expect',
        '--target',
      ].includes(flag) ||
      Object.hasOwn(options, flag)
    )
      throw Error('Unknown or duplicate operator option')
    if (
      [
        '--inspect',
        '--apply',
        '--resume',
        '--rollback',
        '--drafts',
        '--episodes',
        '--park-open',
        '--restore',
        '--reset',
        '--destroy-no-backup',
        '--offline',
      ].includes(flag)
    )
      options[flag] = true
    else {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw Error('Missing operator option value')
      options[flag] = value
    }
  }
  if (['--inspect', '--apply', '--resume', '--rollback'].filter((key) => options[key]).length !== 1)
    throw Error('Select exactly --inspect, --apply, --resume or --rollback')
  if (
    options['--reset'] &&
    ['--drafts', '--episodes', '--park-open', '--restore', '--resume', '--rollback'].some(
      (key) => options[key],
    )
  )
    throw Error('Reset is separate from all recovery selectors')
  if (options['--destroy-no-backup'] && (!options['--reset'] || !options['--apply']))
    throw Error('Destruction confirmation belongs only to reset apply')
  if (options['--reset'] && options['--apply'] && !options['--destroy-no-backup'])
    throw Error('Reset apply requires --destroy-no-backup')
  if (options['--rollback'] && !options['--drafts'])
    throw Error('Rollback belongs to the terminal-draft archive operator')
  if ((options['--park-open'] || options['--restore']) && !options['--drafts'])
    throw Error('Parking/restore belongs to the draft operator')
  if (options['--park-open'] && options['--restore']) throw Error('Select parking or restore')
  if ((options['--park-open'] || options['--restore']) && (options['--resume'] || options['--rollback']))
    throw Error('Checkpoint recovery uses --drafts without parking/restore selectors')
  if (
    options['--episodes'] &&
    (options['--drafts'] || options['--park-open'] || options['--restore'] || options['--rollback'])
  )
    throw Error('Episode recovery is separate from draft/publication recovery')
  const canonical = (path) => {
    if (
      typeof path !== 'string' ||
      !isAbsolute(path) ||
      resolve(path) !== path ||
      realpathSync(path) !== path
    )
      throw Error('Explicit canonical absolute operator paths required')
    return path
  }
  stage = 'owner-preflight'
  const agentDir = canonical(options['--agent-dir'])
  const project = canonical(options['--project'])
  const product = canonical(dirname(fileURLToPath(import.meta.url)))
  const selectionFile = readBootstrapFile(join(agentDir, '.mahiro-memory-engine.json'))
  if (!selectionFile || selectionFile.mode !== 0o600) throw Error('Existing private ABI2 selection required')
  const selection = JSON.parse(selectionFile.text)
  if (
    selection.version !== 2 ||
    selection.mode !== 'engine' ||
    selection.root !== join(agentDir, 'memory') ||
    Object.keys(selection).sort().join() !== 'mode,root,version'
  )
    throw Error('Existing standard ABI2 owner required')
  const settingsFile = readBootstrapFile(join(agentDir, 'settings.json'))
  if (!settingsFile) throw Error('Existing owner installation required')
  const settings = JSON.parse(settingsFile.text)
  const packageSources = [
    join(product, 'node_modules/@gotgenes/pi-permission-system'),
    join(product, 'node_modules/@gotgenes/pi-subagents'),
    product,
  ]
  const packages = packageSources.map((source) => canonical(realpathSync(source)))
  // Accept only the installer's declared locator or its exact current physical owner.
  // The native request still loads the canonical physical owners, never arbitrary aliases.
  if (
    !Array.isArray(settings.packages) ||
    packageSources.some(
      (source, index) => !settings.packages.includes(source) && !settings.packages.includes(packages[index]),
    )
  )
    throw Error('Required canonical public owners must already be installed; installer is separate')
  const action = options['--reset']
    ? options['--inspect']
      ? 'offline-reset-inspect'
      : 'offline-reset'
    : options['--episodes']
      ? options['--inspect']
        ? 'offline-episode-inspect'
        : options['--apply']
          ? 'offline-episode-recover'
          : 'offline-episode-resume'
      : options['--park-open']
        ? options['--inspect']
          ? 'offline-draft-park-inspect'
          : 'offline-draft-park'
        : options['--restore']
          ? options['--inspect']
            ? 'offline-draft-restore-inspect'
            : 'offline-draft-restore'
          : options['--drafts']
            ? options['--inspect']
              ? 'offline-draft-inspect'
              : options['--apply']
                ? 'offline-draft-archive'
                : options['--rollback']
                  ? 'offline-draft-rollback'
                  : 'offline-draft-resume'
            : options['--inspect']
              ? 'offline-inspect'
              : options['--apply']
                ? 'offline-adopt'
                : 'offline-resume'
  const inspection = action.endsWith('inspect')
  const restoreInspection = action === 'offline-draft-restore-inspect'
  if (restoreInspection && !/^[a-f0-9-]{36}$/.test(options['--target'] ?? ''))
    throw Error('Restore inspection requires the completed parking target')
  const targetPattern = [
    'offline-reset',
    'offline-draft-archive',
    'offline-draft-park',
    'offline-episode-recover',
    'offline-episode-resume',
  ].includes(action)
    ? /^[a-f0-9]{64}$/
    : /^[a-f0-9-]{36}$/
  if (
    !inspection &&
    (!options['--offline'] ||
      !/^[a-f0-9]{64}$/.test(options['--expect'] ?? '') ||
      !targetPattern.test(options['--target'] ?? ''))
  )
    throw Error('Apply/resume/rollback requires --offline, --target and exact reviewed --expect')
  if (
    inspection &&
    (options['--offline'] || options['--expect'] || (!restoreInspection && options['--target']))
  )
    throw Error('Inspection takes no adoption arguments')
  const operation = {
    action,
    ...(inspection
      ? restoreInspection
        ? { target: options['--target'] }
        : {}
      : {
          target: options['--target'],
          revision: options['--expect'],
          offline: 'known-profile-closed-no-cooperative-writers-start',
          ...(options['--reset'] ? { destruction: 'destroy-entire-standard-memory-root-no-backup' } : {}),
        }),
  }
  const request = {
    mode: 'offline-memory-maintenance',
    agentDir,
    project,
    root: selection.root,
    packages,
    operation,
  }
  // Explicit known-profile closure is the operator's assurance, NOT proof of lost executor drain.
  const child = spawn(process.execPath, [join(product, 'lib/bootstrap-native.mjs')], {
    cwd: project,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      MAHIRO_AGENT_MEMORY_ROOT: selection.root,
      MAHIRO_BOOTSTRAP_REQUEST: JSON.stringify(request),
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  stage = 'native-process'
  const chunks = []
  const diagnostics = []
  let bytes = 0
  let errors = 0
  child.stdout.on('data', (chunk) => {
    bytes += chunk.length
    if (bytes <= 65536) chunks.push(chunk)
  })
  child.stderr.on('data', (chunk) => {
    errors += chunk.length
    if (errors <= 65536) diagnostics.push(chunk)
  })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
  })
  // Accept only this fixed schema, never forward subprocess text or arbitrary fields.
  if (errors <= 65536) {
    try {
      const value = JSON.parse(Buffer.concat(diagnostics).toString('utf8'))
      if (
        value.diagnostic === 'mahiro-offline-native-v1' &&
        (Object.keys(value).sort().join() === 'code,diagnostic,stage' ||
          (Object.keys(value).sort().join() === 'code,diagnostic,ownerCode,stage' &&
            value.code === 'extension-rejected' &&
            [
              'holder-present',
              'holder-inspection',
              'unsafe-entry',
              'scan',
              'authority',
              'reset-owner',
              'reset-binding',
              'offline-context',
              'maintenance-authority',
              'idle',
              'branch',
              'standard-root',
              'reset-preflight',
              'reset-controller-busy',
              'reset-request-shape',
              'fingerprint',
              'recovery-plan',
              'recovery-commit',
              'recovery-proposal',
            ].includes(value.ownerCode))) &&
        [
          'request',
          'public-sdk',
          'model-runtime',
          'resource-load',
          'session-create',
          'session-bind',
          'owner-health',
          'guarded-operation',
          'receipt',
          'shutdown',
        ].includes(value.stage) &&
        [
          'native-failure',
          'pre-execution-rejected',
          'extension-rejected',
          'receipt-missing',
          'receipt-invalid',
          'projection-unexpected',
          'workers-unexpected',
        ].includes(value.code)
      )
        nativeDiagnostic = {
          stage: value.stage,
          code: value.code,
          ...(value.ownerCode ? { ownerCode: value.ownerCode } : {}),
        }
    } catch {
      /* Untrusted subprocess output is deliberately discarded. */
    }
  }
  if (code !== 0 || bytes > 65536 || errors > 65536) throw Error('Guarded offline owner refused')
  stage = 'receipt'
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!result.maintenance || result.externalRequests !== 0) throw Error('Guarded offline receipt unavailable')
  console.log(JSON.stringify(result))
} catch {
  console.error(
    JSON.stringify({
      diagnostic: 'mahiro-offline-cli-v1',
      stage,
      code,
      ...(nativeDiagnostic ? { native: nativeDiagnostic } : {}),
    }),
  )
  console.error(
    resetApply
      ? 'Offline reset apply refused or interrupted; its root may be partially deleted. Re-inspect before retry. No private payload emitted.'
      : resetting
        ? 'Offline reset inspection refused; inspection does not delete memory. Verify existing owner, exact permissions and system lsof. No private payload emitted.'
        : 'Offline memory maintenance refused. Preserve Root/checkpoints; verify existing owner, exact permissions, reviewed arguments and system lsof. No private payload emitted.',
  )
  process.exitCode = 1
}
