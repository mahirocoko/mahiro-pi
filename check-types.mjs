import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const configPath = resolve(root, 'tsconfig.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, root, undefined, configPath)
const configurationErrors = [...(config.error ? [config.error] : []), ...parsed.errors]
const host = {
  getCanonicalFileName: (name) => name,
  getCurrentDirectory: () => root,
  getNewLine: () => '\n',
}
if (configurationErrors.length) {
  console.error(ts.formatDiagnostics(configurationErrors, host))
  process.exitCode = 1
} else {
  assert.equal(parsed.options.noEmit, true, 'The owned TypeScript gate must never emit files')
  assert.equal(parsed.options.strict, true, 'Owned TypeScript remains strict')
  const authored = []
  const collect = (directory) => {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`
      if (entry.name === 'node_modules' || entry.name === '.agent-state') continue
      if (name === 'test/oracles') continue // immutable upstream evidence, not authored source
      assert.ok(!entry.isSymbolicLink(), `${name}: linked authored source is not an owned compiler root`)
      if (entry.isDirectory()) collect(name)
      else if (name.endsWith('.ts')) authored.push(resolve(root, name))
    }
  }
  for (const directory of ['lib', 'extensions', 'test']) collect(directory)
  for (const entry of readdirSync(root, { withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith('.ts')) authored.push(resolve(root, entry.name))

  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const compiled = new Set(program.getSourceFiles().map((file) => resolve(file.fileName)))
  for (const name of authored)
    assert.ok(compiled.has(name), `${relative(root, name)}: authored TypeScript omitted from compiler`)
  for (const file of program.getSourceFiles()) {
    const name = relative(root, resolve(file.fileName)).split(sep).join('/')
    assert.ok(
      !isAbsolute(name) && name !== '..' && !name.startsWith('../'),
      `${name}: compiler escaped public package supply`,
    )
    assert.ok(
      !name.startsWith('.agent-state/') && !name.startsWith('test/oracles/'),
      `${name}: private or immutable evidence entered compiler`,
    )
    assert.ok(
      name.startsWith('node_modules/') ||
        authored.includes(resolve(file.fileName)) ||
        /\.(mjs|js)$/.test(name),
      `${name}: undeclared compiler input`,
    )
  }
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length) {
    console.error(ts.formatDiagnostics(diagnostics, host))
    process.exitCode = 1
  } else {
    console.log(
      `TypeScript ${ts.version}: ${authored.length} authored TS files checked; ${compiled.size} total compiler inputs; no emit, zero diagnostics.`,
    )
    console.log(
      'JS interoperability is inferred, not a checkJs migration. External declarations use skipLibCheck; owned TS is strict.',
    )
  }
}
