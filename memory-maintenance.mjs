#!/usr/bin/env node
// Explicit operator entry only. No installation, provisioning, inference, session control or repair FS here.
import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBootstrapFile } from './lib/bootstrap.ts'

try {
  const args = process.argv.slice(2)
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
        '--offline',
        '--expect',
        '--target',
      ].includes(flag) ||
      Object.hasOwn(options, flag)
    )
      throw Error('Unknown or duplicate operator option')
    if (['--inspect', '--apply', '--resume', '--offline'].includes(flag)) options[flag] = true
    else {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw Error('Missing operator option value')
      options[flag] = value
    }
  }
  if (['--inspect', '--apply', '--resume'].filter((key) => options[key]).length !== 1)
    throw Error('Select exactly --inspect, --apply or --resume')
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
  const packages = [
    canonical(realpathSync(join(product, 'node_modules/@gotgenes/pi-permission-system'))),
    canonical(realpathSync(join(product, 'node_modules/@gotgenes/pi-subagents'))),
    product,
  ]
  if (!Array.isArray(settings.packages) || packages.some((path) => !settings.packages.includes(path)))
    throw Error('Required canonical public owners must already be installed; installer is separate')
  const action = options['--inspect']
    ? 'offline-inspect'
    : options['--apply']
      ? 'offline-adopt'
      : 'offline-resume'
  if (
    action !== 'offline-inspect' &&
    (!options['--offline'] ||
      !/^[a-f0-9]{64}$/.test(options['--expect'] ?? '') ||
      !/^[a-f0-9-]{36}$/.test(options['--target'] ?? ''))
  )
    throw Error('Apply/resume requires --offline, --target and exact reviewed --expect')
  if (action === 'offline-inspect' && (options['--offline'] || options['--expect'] || options['--target']))
    throw Error('Inspection takes no adoption arguments')
  const operation = {
    action,
    ...(action === 'offline-inspect'
      ? {}
      : {
          target: options['--target'],
          revision: options['--expect'],
          offline: 'known-profile-closed-no-cooperative-writers-start',
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
  const chunks = []
  let bytes = 0
  let errors = 0
  child.stdout.on('data', (chunk) => {
    bytes += chunk.length
    if (bytes <= 65536) chunks.push(chunk)
  })
  child.stderr.on('data', (chunk) => {
    errors += chunk.length
  })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
  })
  if (code !== 0 || bytes > 65536 || errors > 65536) throw Error('Guarded offline owner refused')
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!result.maintenance || result.externalRequests !== 0) throw Error('Guarded offline receipt unavailable')
  console.log(JSON.stringify(result))
} catch {
  console.error(
    'Offline memory maintenance refused. Preserve Root/checkpoints; verify existing owner, exact permissions, reviewed arguments and system lsof. No private payload emitted.',
  )
  process.exitCode = 1
}
