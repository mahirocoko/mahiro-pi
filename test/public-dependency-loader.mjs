// Test-only explicit public package supply for the canonical source checkout.
// Never loaded by the extension or bootstrap CLI in normal use; no runtime fallback.
import { registerHooks } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const modules = process.env.MAHIRO_PI_TEST_MODULES
if (modules) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const allowed = new Set([
    '@gotgenes/pi-permission-system',
    '@gotgenes/pi-subagents',
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-ai',
    '@earendil-works/pi-tui',
    'typebox',
  ])
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : ''
      if (
        allowed.has(specifier) &&
        (parent.startsWith(path.join(root, 'lib/guards') + path.sep) ||
          parent === path.join(root, 'lib/bootstrap-native.mjs') ||
          [
            'test/install-ready.test.ts',
            'test/claude-ui-fixture.ts',
            'test/claude-ui.test.ts',
            'test/claude-ui-polish.test.ts',
            'extensions/mahiro-claude-ui.ts',
          ].some((file) => parent === path.join(root, file)))
      ) {
        const packageRoot = path.join(modules, specifier),
          metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
        const exports = metadata.exports?.['.']
        const entry =
          typeof exports === 'string' ? exports : (exports?.import ?? exports?.default ?? metadata.main)
        if (metadata.name !== specifier || typeof entry !== 'string')
          throw Error('Invalid explicit public test dependency')
        return nextResolve(pathToFileURL(path.resolve(packageRoot, entry)).href, context)
      }
      return nextResolve(specifier, context)
    },
  })
  // Public subprocesses in source tests inherit the same narrow test-only resolver.
  const flag = `--import=${pathToFileURL(import.meta.filename).href}`
  if (!(process.env.NODE_OPTIONS ?? '').includes(flag))
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} ${flag}`.trim()
}
