import assert from 'node:assert/strict'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const pages = ['README.md', 'AGENTS.md', 'THIRD_PARTY_NOTICES.md']
async function collect(directory) {
  for (const entry of await readdir(resolve(root, directory), {
    withFileTypes: true,
  })) {
    const name = `${directory}/${entry.name}`
    assert.ok(!entry.isSymbolicLink(), `${name}: linked documentation`)
    if (entry.isDirectory()) await collect(name)
    else if (name.endsWith('.md')) pages.push(name)
  }
}
await collect('docs')
const texts = new Map(
  await Promise.all(pages.map(async (name) => [name, await readFile(resolve(root, name), 'utf8')])),
)
const inside = (path) => {
  const local = relative(root, path)
  return !isAbsolute(local) && local.split(sep)[0] !== '..'
}
function prose(text) {
  const lines = []
  let fence
  for (const line of text.split('\n')) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (mark && !fence) fence = mark[1]
    else if (mark && mark[1][0] === fence?.[0] && mark[1].length >= fence.length) fence = undefined
    else if (!fence) lines.push(line)
  }
  return lines.join('\n')
}
function headings(text) {
  const counts = new Map()
  const ids = new Set()
  for (const match of prose(text).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = match[1]
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
      .replace(/ /g, '-')
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    ids.add(count ? `${base}-${count}` : base)
  }
  return ids
}
const graph = new Map()
let links = 0
async function checkLink(name, target) {
  if (/^(?:https?:|mailto:)/.test(target)) return
  assert.ok(!/^[a-z][\w+.-]*:/i.test(target), `${name}: unsupported URL: ${target}`)
  const [path, fragment] = target.split('#')
  const absolute = resolve(root, dirname(name), decodeURIComponent(path || ''))
  const destination = path ? absolute : resolve(root, name)
  assert.ok(inside(destination), `${name}: link escapes repository: ${target}`)
  const info = await stat(destination).catch(() => undefined)
  assert.ok(info, `${name}: missing local target: ${target}`)
  assert.ok(inside(await realpath(destination)), `${name}: linked target escapes repository: ${target}`)
  const local = relative(root, destination).split(sep).join('/')
  graph.get(name).add(local)
  if (fragment && destination.endsWith('.md')) {
    const targetText = texts.get(local) ?? (await readFile(destination, 'utf8'))
    assert.ok(headings(targetText).has(decodeURIComponent(fragment)), `${name}: missing anchor: ${target}`)
  }
  links++
}
for (const [name, text] of texts) {
  assert.ok(text.endsWith('\n'), `${name}: missing final newline`)
  assert.ok(!/[\t ]+$/m.test(text), `${name}: trailing whitespace`)
  graph.set(name, new Set())
  const content = prose(text)
  const definitions = new Map()
  const label = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase()
  for (const match of content.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*<?([^\s>]+)>?/gm)) {
    definitions.set(label(match[1]), match[2])
    await checkLink(name, match[2])
  }
  for (const match of content.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g))
    await checkLink(name, match[1])
  for (const match of content.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const id = label(match[2] || match[1])
    assert.ok(definitions.has(id), `${name}: missing link definition: ${id}`)
  }
}
// All public guides must be navigable, not necessarily duplicated in the README.
const reachable = new Set()
function visit(name) {
  if (reachable.has(name)) return
  reachable.add(name)
  for (const next of graph.get(name) ?? []) visit(next)
}
visit('README.md')
for (const name of pages.filter((page) => page.startsWith('docs/')))
  assert.ok(reachable.has(name), `${name}: not reachable from product README`)

// A new manifest resource must have a deliberate documentation owner. This is
// an ownership map, not a fixed guide count or a copy of migration history.
const owners = {
  './lib/guards/bootstrap.ts': 'docs/guards.md',
  './lib/guards/index.ts': 'docs/guards.md',
  './extensions/mahiro-status.ts': 'docs/status.md',
  './extensions/mahiro-finish-voice.ts': 'docs/status.md#completion-voice',
  './extensions/mahiro-agent-memory.ts': 'docs/agent-memory.md',
  './extensions/mahiro-continuity.ts': 'docs/agent-memory.md#historical-recall-and-quoted-notes',
  './extensions/mahiro-native-utilities.ts': 'docs/utilities.md',
  './extensions/mahiro-code-map.ts': 'docs/utilities.md#code-map',
  './extensions/mahiro-goal.ts': 'docs/workflows.md#goals',
  './extensions/mahiro-code-evidence.ts': 'docs/workflows.md#code-evidence',
  './extensions/mahiro-ux-workflow.ts': 'docs/workflows.md#ux-workflow',
  './extensions/mahiro-execution-run.ts': 'docs/workflows.md#execution-run',
  './extensions/mahiro-claude-ui.ts': 'docs/claude-ui.md',
}
for (const entry of manifest.pi.extensions) {
  assert.ok(owners[entry], `Undocumented manifest resource: ${entry}`)
  await checkLink('README.md', owners[entry])
}
for (const entry of Object.keys(owners))
  assert.ok(manifest.pi.extensions.includes(entry), `Stale resource owner: ${entry}`)

assert.ok(texts.get('README.md').includes(`v${manifest.version}`), 'README/version drift')
assert.ok(texts.has(`docs/releases/${manifest.version}.md`), 'Missing current release record')
assert.equal(manifest.private, true, 'Review public distribution documentation before publication')
assert.equal(manifest.license, 'UNLICENSED', 'Review license documentation before a license change')
// Architecture reminders, not runtime acceptance. The old version/provenance
// assertions described the retired permission plane and must not resurrect it.
const rootGuard = await readFile(resolve(root, 'lib/guards/index.ts'), 'utf8')
const bootstrap = await readFile(resolve(root, 'lib/guards/bootstrap.ts'), 'utf8')
const kernel = await readFile(resolve(root, 'lib/kernel/index.ts'), 'utf8')
assert.doesNotMatch(rootGuard, /createOwnedProvenance|unsupported tool\/alias|createPowerShellToolDefinition/)
assert.doesNotMatch(bootstrap, /pi\.on\(['"]tool_call/)
assert.match(bootstrap, /ui\.notify/)
assert.match(kernel, /requireFeaturePermission/)
assert.doesNotMatch(kernel, /(?:from|import\()\s*['"][^'"]*provenance/)
assert.match(texts.get('docs/guards.md'), /wildcard and yolo/)
assert.match(texts.get('docs/guards.md'), /no.*?second dispatch allowlist/s)

// Narrow regressions for omissions that materially change the public contract.
// These assertions are reminders for semantic review, never proof of execution.
const contracts = [
  ['docs/guards.md', /first recognized.*?operand/s, 'bounded Bash operand gate'],
  ['docs/guards.md', /final Bash recheck.*?command policy/s, 'final command-policy distinction'],
  ['docs/guards.md', /consumeBashApproval/, 'aggregate effective Bash approval'],
  [
    'docs/guards.md',
    /does not run a\s+second transformed-command permission algorithm/,
    'no duplicate transformed-command authority',
  ],
  ['docs/guards.md', /not an OS sandbox/, 'sandbox limitation'],
  ['docs/bootstrap.md', /never substitutes blanket allow/, 'scalar-only deny removal'],
  ['docs/claude-ui.md', /runtime-only/, 'Apply is not Save'],
  ['docs/claude-ui.md', /create\/overwrite unknown/, 'no write before-image'],
  ['docs/agent-memory.md', /not secure Git\/history erasure/, 'logical forgetting'],
  ['docs/workflows.md', /never executed/, 'recorded commands are metadata'],
  ['docs/integrations.md', /UNKNOWN/, 'unavailable is not zero'],
]
for (const [name, pattern, contract] of contracts)
  assert.match(texts.get(name) ?? '', pattern, `${name}: missing ${contract}`)
for (const [name, text] of texts) {
  if (name.startsWith('docs/releases/') || name === 'THIRD_PARTY_NOTICES.md') continue
  assert.doesNotMatch(text, /\/(?:Users|home)\/[a-zA-Z0-9_.-]+/, `${name}: personal home path`)
  assert.doesNotMatch(text, /\bT\d{2,}\b/, `${name}: private task diary reference`)
}
const attributes = await readFile(resolve(root, '.gitattributes'), 'utf8')
assert.match(attributes, /^\.agent-state export-ignore$/m)
assert.match(attributes, /^\.pi export-ignore$/m)
console.log(
  `Documentation checks passed: ${pages.length} pages, ${links} local targets. External links, source semantics and runtime activation require separate review.`,
)
