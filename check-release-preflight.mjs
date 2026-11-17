import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const probe = (command) =>
  spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  })

/** @param {{ nodeVersion?: string, nodeExecutable?: string, run?: (command: string) => { status: number | null, stdout?: string, error?: Error } }} [options] */
export function releasePreflight({
  nodeVersion = process.versions.node,
  nodeExecutable = process.execPath,
  run = probe,
} = {}) {
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion)
  const nodeOK = !!version && (+version[1] > 22 || (+version[1] === 22 && +version[2] >= 19))
  const checks = [{ name: 'Node >=22.19.0', command: nodeExecutable, version: nodeVersion, ok: nodeOK }]
  for (const [name, commands, pattern] of [
    ['Bun', ['bun'], /^(?:bun\s+)?(\d+\.\d+\.\d+)\b/m],
    ['fd', ['fd', 'fdfind'], /^(?:fd|fdfind)\s+(\d+\.\d+\.\d+)\b/m],
    ['ripgrep', ['rg'], /^ripgrep\s+(\d+\.\d+\.\d+)\b/m],
  ]) {
    let found
    for (const command of commands) {
      const result = run(command)
      const matched = !result.error && result.status === 0 && pattern.exec(result.stdout ?? '')
      if (matched) {
        found = { name, command, version: matched[1], ok: true }
        break
      }
    }
    checks.push(found ?? { name, command: commands.join(' or '), version: null, ok: false })
  }
  return { ok: checks.every((check) => check.ok), checks }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = releasePreflight()
  for (const check of result.checks)
    console.log(
      `${check.ok ? 'OK' : 'MISSING'} ${check.name}: ${check.command}${check.version ? ` (${check.version})` : ''}`,
    )
  if (!result.ok) {
    console.error(
      "Release preflight failed. Supply the missing tools on this executor's PATH before retrying. No suites, downloads or profile changes were started.",
    )
    process.exitCode = 1
  }
}
