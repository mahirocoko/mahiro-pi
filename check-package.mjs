import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('.', import.meta.url))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
assert.equal(manifest.name, '@mahirocoko/mahiro-pi')
assert.equal(manifest.version, '0.11.0')
const rootGuard = await readFile(resolve(root, 'lib/guards/index.ts'), 'utf8')
assert.doesNotMatch(rootGuard, /owned-provenance|createMetaProvenance|unsupported tool\/alias/)
assert.doesNotMatch(
  rootGuard,
  /createPowerShellToolDefinition/,
  'Do not replace a native tool with a throwing wrapper',
)
const guardHost = await readFile(resolve(root, 'lib/guards/host.mjs'), 'utf8')
assert.match(guardHost, /createFilteredTools/)
assert.match(guardHost, /assertSecretPaths/)
assert.doesNotMatch(guardHost, /activateSecrets|createChecker|from ['"].*mahiro-secret-read-guard/)
assert.doesNotMatch(guardHost, /permissions:|checks\.values|COMMIT_CHECK|tools:\s*\{|tool_start/)
const guardProvenance = JSON.parse(await readFile(resolve(root, 'lib/guards/provenance.json'), 'utf8'))
const oracleProvenance = JSON.parse(
  await readFile(resolve(root, 'test/oracles/letta/provenance.json'), 'utf8'),
)
assert.equal(guardProvenance.originals.length, 2)
for (const entry of guardProvenance.originals) {
  const original = oracleProvenance.files.find((file) => file.original === entry.original)
  assert.ok(original, `Unknown guard original: ${entry.original}`)
  assert.equal(entry.path, `../../test/oracles/letta/${original.path}`)
  assert.equal(entry.sha256, original.sha256)
  const bytes = await readFile(resolve(root, 'lib/guards', entry.path))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256)
}
assert.deepEqual(guardProvenance.adaptations, [])
for (const path of [
  'lib/guards/mahiro-secret-read-guard.js',
  'lib/guards/mahiro-commit-attribution-guard.js',
])
  await assert.rejects(readFile(resolve(root, path)), { code: 'ENOENT' })
const filtered = await readFile(resolve(root, 'lib/guards/filtered-config.mjs'), 'utf8')
assert.doesNotMatch(filtered, /node:child_process|createChecker|const POLICY/)
const kernel = await readFile(resolve(root, 'lib/kernel/index.ts'), 'utf8')
assert.doesNotMatch(kernel, /(?:from|import\()\s*['"][^'"]*provenance|createGuardHost|host\.healthy/)
assert.doesNotMatch(rootGuard, /nodes\.(?:set|delete)\(/, 'Root must not publish or retire feature nodes')
assert.match(await readFile(resolve(root, 'lib/guards/bootstrap.ts'), 'utf8'), /await activateKernel\(pi\)/)

assert.equal(manifest.private, true)
assert.equal(manifest.packageManager, 'pnpm@10.33.0')
assert.equal(manifest.engines.node, '>=22.19.0')
const extensions = JSON.parse(await readFile(resolve(root, 'test/candidate-extensions.json'), 'utf8'))
assert.deepEqual(extensions.active, [
  './lib/guards/bootstrap.ts',
  './lib/guards/index.ts',
  './extensions/mahiro-status.ts',
  './extensions/mahiro-finish-voice.ts',
  './extensions/mahiro-agent-memory.ts',
  './extensions/mahiro-continuity.ts',
  './extensions/mahiro-native-utilities.ts',
  './extensions/mahiro-code-map.ts',
  './extensions/mahiro-goal.ts',
  './extensions/mahiro-code-evidence.ts',
  './extensions/mahiro-ux-workflow.ts',
  './extensions/mahiro-execution-run.ts',
  './extensions/mahiro-claude-ui.ts',
])
assert.deepEqual(manifest.pi.extensions, extensions.active, 'Actual resource graph must be guards-first')
assert.deepEqual(
  extensions.candidate,
  extensions.active,
  'Disposable fixtures use the actual authoring graph, not another runtime owner',
)
assert.equal(manifest.devDependencies['@biomejs/biome'], '2.5.14')
assert.equal(manifest.devDependencies.typescript, '6.0.3')
assert.equal(manifest.devDependencies['@types/node'], '22.19.19')
assert.equal(manifest.scripts['check:types'], 'node check-types.mjs')
assert.equal(manifest.scripts.check, 'pnpm check:fast')
assert.equal(
  manifest.scripts['check:fast'],
  'pnpm check:state && pnpm check:types && pnpm check:format && node check-package.mjs && pnpm check:docs',
)
assert.equal(
  manifest.scripts['check:source'],
  'node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/*.test.ts && pnpm check:state',
)
assert.equal(
  manifest.scripts['check:release'],
  'pnpm check:fast && pnpm check:source && pnpm check:public-sdk && pnpm check:state',
)
assert.equal(manifest.scripts.test, 'pnpm check:source')
assert.equal(manifest.scripts['check:state'], 'node check-state.mjs')
assert.equal(manifest.scripts['check:public-sdk'], 'node check-public-sdk.mjs')
assert.equal(manifest.scripts.format, 'biome format --write .')
assert.equal(manifest.scripts['check:format'], 'biome format .')
const biome = JSON.parse(await readFile(resolve(root, 'biome.json'), 'utf8'))
assert.deepEqual(biome.formatter, { indentStyle: 'space', indentWidth: 2, lineWidth: 110, lineEnding: 'lf' })
assert.deepEqual(biome.javascript.formatter, {
  quoteStyle: 'single',
  semicolons: 'asNeeded',
  trailingCommas: 'all',
  arrowParentheses: 'always',
  bracketSpacing: true,
  quoteProperties: 'asNeeded',
})
assert.equal(biome.json.formatter.trailingCommas, 'none')
for (const pattern of [
  '*.mjs',
  '*.ts',
  '*.json',
  'lib/**',
  'extensions/**',
  'test/**',
  'themes/**',
  'assets/**/*.json',
  '!!.agent-state',
  '!!**/node_modules',
  '!!test/oracles',
])
  assert.ok(biome.files.includes.includes(pattern), `Missing formatter owner/boundary: ${pattern}`)
for (const pattern of [
  '!!lib/guards/mahiro-secret-read-guard.js',
  '!!lib/guards/mahiro-commit-attribution-guard.js',
])
  assert.ok(!biome.files.includes.includes(pattern), `Deleted runtime guard must not be excluded: ${pattern}`)
assert.equal(manifest.letta, undefined)
assert.equal(manifest.scripts.setup, 'node setup.mjs')
assert.equal(manifest.scripts.bootstrap, 'node bootstrap.mjs')
const imports = (source) =>
  ts
    .createSourceFile('source.ts', source, ts.ScriptTarget.Latest)
    .statements.filter(ts.isImportDeclaration)
    .map((entry) => entry.moduleSpecifier.text)
assert.ok(imports(await readFile(resolve(root, 'bootstrap.mjs'), 'utf8')).includes('./lib/bootstrap.ts'))
assert.ok(
  (await readFile(resolve(root, 'lib/bootstrap.ts'), 'utf8')).includes('export const inspectBootstrap'),
)
assert.ok(
  /(['"])agent_memory_manage\1/.test(await readFile(resolve(root, 'lib/bootstrap-native.mjs'), 'utf8')),
)
assert.ok(imports(await readFile(resolve(root, 'setup.mjs'), 'utf8')).includes('./lib/setup.ts'))
assert.ok((await readFile(resolve(root, 'lib/setup.ts'), 'utf8')).includes('export const planSetup'))
assert.deepEqual(manifest.pi.skills, ['./skills'])
assert.deepEqual(manifest.pi.themes, [
  './themes/mahiro-claude-dark.json',
  './themes/mahiro-obsidian-dark.json',
  './themes/mahiro-ember-dark.json',
  './themes/mahiro-nordic-dark.json',
])
for (const peer of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui']) {
  assert.equal(manifest.peerDependencies[peer], '>=1.3.0')
  assert.equal(manifest.peerDependenciesMeta[peer].optional, true)
}
assert.equal((await readFile(resolve(root, '.npmrc'), 'utf8')).trim(), 'auto-install-peers=false')
const args = process.argv.slice(2)
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === '--compare-source'),
  'Expected --compare-source <old-pi-root>',
)
const original = args.length ? resolve(args[1]) : undefined
const roots = new Set(['extensions', 'lib', 'test', 'docs', 'agents', 'skills', 'themes', 'assets'])
const files = new Set([
  'package.json',
  'AGENTS.md',
  'README.md',
  'check-package.mjs',
  'check-types.mjs',
  'check-docs.mjs',
  'check-public-sdk.mjs',
  'check-state.mjs',
  'test-state.mjs',
  'biome.json',
  'tsconfig.json',
  'setup.mjs',
  'bootstrap.mjs',
  'install.mjs',
  'goal-preview.mjs',
  'check-geometry.ts',
  '.gitignore',
])
let compared = 0
async function inspect(directory = '') {
  for (const item of await readdir(resolve(root, directory), { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue
    if (!directory && !(item.isDirectory() ? roots.has(item.name) : files.has(item.name))) continue
    if (directory === 'test' && item.name === 'oracles') continue // frozen originals retain their dated bytes
    if (
      item.name.startsWith('.') ||
      /(?:auth|credential|secret|token|settings|mcp)(?:[.-]|$)/i.test(item.name)
    )
      continue
    const name = directory ? `${directory}/${item.name}` : item.name
    if (item.isDirectory()) {
      await inspect(name)
      continue
    }
    if (!/\.(?:ts|mjs|json|md)$/.test(name) && !['.gitignore', '.npmrc'].includes(name)) continue
    const bytes = await readFile(resolve(root, name))
    const source = bytes.toString('utf8')
    assert.ok(!/[\t ]+$/m.test(source), `${name}: trailing whitespace`)
    assert.ok(source.endsWith('\n'), `${name}: missing final newline`)
    if (/^(extensions|lib)\//.test(name)) {
      for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
        const specifier = match[1]
        assert.ok(
          specifier.startsWith('node:') ||
            /^\.\.?\//.test(specifier) ||
            [
              '@earendil-works/pi-coding-agent',
              '@earendil-works/pi-tui',
              'typebox',
              'typebox/value',
              '@gotgenes/pi-permission-system',
              '@gotgenes/pi-subagents',
              ...(name.startsWith('lib/guards/test/') ? ['@earendil-works/pi-ai', 'esbuild'] : []),
            ].includes(specifier),
          `${name}: unexpected import ${specifier}`,
        )
        if (specifier.startsWith('.'))
          assert.ok(resolve(root, name, '..', specifier).startsWith(root), `${name}: import escapes package`)
      }
    }
    if (original && /^(extensions|lib|test)\//.test(name)) {
      assert.deepEqual(bytes, await readFile(resolve(original, name)), `${name}: source drift`)
      compared++
    }
  }
}
await inspect()

const identityDirectory = resolve(root, 'assets/identity/mahiro-black-cat')
const identityManifest = JSON.parse(await readFile(resolve(identityDirectory, 'manifest.json'), 'utf8'))
assert.equal(identityManifest.schemaVersion, 'mahiro-identity-pack.v1')
assert.equal(
  identityManifest.humanLockedSource.sha256,
  'bb6a0cfc9fef76fc668038ea210486d5e99e3ec0bc3f54d5882eb30eba486c81',
)
assert.deepEqual(identityManifest.palette, {
  nearBlack: '#0A0606',
  violet: '#A552FC',
  warmCream: '#FDF5D9',
  lavenderSurface: '#DED0FD',
})
const identityEntries = await readdir(identityDirectory, { withFileTypes: true })
const expectedIdentityNames = [...identityManifest.files.map((entry) => entry.file), 'manifest.json'].sort()
assert.deepEqual(
  identityEntries.map((entry) => entry.name).sort(),
  expectedIdentityNames,
  'Identity assets and manifest inventory must remain exact',
)
for (const entry of identityEntries)
  assert.ok(entry.isFile() && !entry.isSymbolicLink(), `${entry.name}: identity entries must be files`)
for (const entry of identityManifest.files) {
  assert.match(entry.file, /^[a-z0-9][a-z0-9.-]+$/, `Unsafe identity filename: ${entry.file}`)
  const bytes = await readFile(resolve(identityDirectory, entry.file))
  assert.equal(bytes.length, entry.bytes, `${entry.file}: byte count drift`)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${entry.file}: hash drift`)
  if (entry.file.endsWith('.png')) {
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    assert.equal(bytes.readUInt32BE(16), entry.width, `${entry.file}: PNG width drift`)
    assert.equal(bytes.readUInt32BE(20), entry.height, `${entry.file}: PNG height drift`)
    assert.equal(bytes[24], 8, `${entry.file}: PNG assets must remain 8-bit`)
    assert.equal(bytes[25] === 6 ? 'RGBA' : bytes[25] === 2 ? 'RGB' : 'unsupported', entry.mode)
  }
  if (entry.file.endsWith('.ico')) {
    assert.deepEqual([...bytes.subarray(0, 4)], [0, 0, 1, 0])
    const imageCount = bytes.readUInt16LE(4)
    assert.equal(imageCount, 3, `${entry.file}: ICO must retain 16/32/48 px frames`)
    const sizes = Array.from({ length: imageCount }, (_, index) => {
      const offset = 6 + index * 16
      return [bytes[offset] || 256, bytes[offset + 1] || 256]
    })
    assert.deepEqual(sizes, [
      [16, 16],
      [32, 32],
      [48, 48],
    ])
    assert.equal(Math.max(...sizes.map(([width]) => width)), entry.width)
    assert.equal(Math.max(...sizes.map(([, height]) => height)), entry.height)
  }
}
const identitySvg = await readFile(resolve(identityDirectory, 'mahiro-black-cat-mark.svg'), 'utf8')
assert.doesNotMatch(identitySvg, /<!DOCTYPE|<(?:script|foreignObject)|\b(?:href|xlink:href)\s*=|url\s*\(/i)
assert.match(identitySvg, /<title id="title">Mahiro black cat<\/title>/)

console.log(
  `Package/import/whitespace checks passed${original ? `; ${compared} copied files byte-identical` : ''}.`,
)
