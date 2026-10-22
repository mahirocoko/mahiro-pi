import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { RTK_HELPER_BOUNDS, rtkModes } from '../lib/rtk.ts'

const root = path.resolve(import.meta.dirname, '..')
const text = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const files = (dir: string): string[] =>
  fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .filter((e) => e.name !== 'node_modules' && e.name !== 'test')
    .flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))

test('retired Saved Models has no executable, manifest, guard ABI, provenance or format surface; actual/mirrored guards-first13 retain exact order', () => {
  const declaration = JSON.parse(text('test/candidate-extensions.json'))
  const pkg = JSON.parse(text('package.json'))
  assert.equal(declaration.active.length, 13)
  assert.deepEqual(pkg.pi.extensions, declaration.active)
  assert.equal(declaration.candidate.length, 13)
  assert.deepEqual(declaration.candidate, declaration.active)
  assert.deepEqual(declaration.active.slice(0, 2), ['./lib/guards/bootstrap.mjs', './lib/guards/index.ts'])
  assert.equal(declaration.active.slice(2, 12).length, 10)
  assert.equal(declaration.active[12], './extensions/mahiro-claude-ui.ts')
  for (const file of [
    'lib/model-profiles.ts',
    'extensions/mahiro-model-profiles.ts',
    'test/model-profiles.test.ts',
  ])
    assert.equal(fs.existsSync(path.join(root, file)), false, file)
  const retired =
    /model-profiles|modelProfiles|model_profiles|mh-model-profile|registerModelProfiles|trustedPreferenceTool/
  for (const file of [
    ...files('lib'),
    ...files('extensions'),
    'package.json',
    'biome.json',
    'check-package.mjs',
    'check-public-sdk.mjs',
    'test/candidate-extensions.json',
  ])
    assert.doesNotMatch(text(file), retired, file)
  assert.ok(
    fs.existsSync(path.join(root, 'test/oracles/letta/mahiro-model-profiles.ts')),
    'historical oracle must not be erased',
  )
  assert.match(text('lib/guards/provenance.mjs'), /export function trustedRTKTool/)
  const biome = JSON.parse(text('biome.json'))
  assert.equal(pkg.scripts.format, 'biome format --write .')
  assert.equal(pkg.scripts['check:format'], 'biome format .')
  assert.ok(biome.files.includes.includes('lib/**'), 'RTK production is owned by broad formatting')
  assert.ok(biome.files.includes.includes('test/**'), 'RTK tests are owned by broad formatting')
})

test('current context owns real RTK helper semantics and retirement, not the historical grammar-only candidate13 contract', () => {
  assert.deepEqual(rtkModes, ['off', 'suggest', 'rewrite-safe', 'rewrite-rtk'])
  assert.deepEqual(RTK_HELPER_BOUNDS, {
    inputBytes: 4096,
    outputBytes: 16384,
    timeoutMs: 1500,
    concurrent: 4,
  })
  // Documentation contracts tolerate wrapping; headings, dates and historical
  // migration tables are not RTK behavior or security guarantees.
  const rtk = text('docs/rtk.md').replace(/\s+/g, ' ')
  const guards = text('docs/guards.md').replace(/\s+/g, ' ')
  // Architecture contracts retain the exact graph label; the product README
  // navigates to those owners instead of repeating an internal migration token.
  for (const owner of ['AGENTS.md', 'docs/bootstrap.md']) assert.match(text(owner), /guards-first13/, owner)
  assert.match(text('README.md'), /\(docs\/guards\.md\)/)
  assert.match(text('README.md'), /\(docs\/rtk\.md\)/)
  assert.match(text('docs/README.md'), /\(rtk\.md\)/)
  for (const owner of ['AGENTS.md', 'README.md', 'docs/bootstrap.md'])
    assert.doesNotMatch(
      text(owner),
      /candidate13|thirteen-resource|No rewrite helper|Both rewrite modes use a bounded deterministic grammar/,
      owner,
    )
  assert.doesNotMatch(
    `${rtk} ${guards}`,
    /candidate13|saved Models last|no .*rewrite.*subprocess|Both rewrite modes use a bounded deterministic grammar/,
  )
  for (const [claim, contract] of [
    ['argv-only resolver', /execFile\("rtk", \["rewrite", "--", original\]\)/],
    ['no helper auto-grant', /no shell\/helper auto-grant/],
    ['bounded input', /4,?096-byte input/],
    ['bounded output', /16,?384-byte output/],
    ['bounded timeout and concurrency', /1,?500 ms and at most four helpers/],
    ['exit 0 candidate', /Exit \*\*0\*\* produces a candidate/],
    [
      'exit 3 requires approval, not an auto-grant',
      /\*\*3\*\* marks approval-required \(`hostApprovalRequired`\), not an auto-grant/,
    ],
    ['exit 1 original and exit 2 denial', /Exit \*\*1\*\* preserves the original; \*\*2\*\* blocks/],
    [
      'failed helpers cannot publish partial candidates',
      /Timeout\/error\/unknown\/oversized\/malformed results fall back only to the guarded original, never partial output/,
    ],
    [
      'original checks precede helper',
      /Original public Bash policy and commit-attribution checks happen before the helper/,
    ],
    [
      'proposal and sanitized final checks precede spawn',
      /Proposed and final sanitizer-transformed arguments must also pass before native spawn/,
    ],
    [
      'fixed private RTK state owner',
      /<profile>\/preferences\/rtk.*exact DATA authority.*0700\/0600.*sequence\/CAS/,
    ],
    [
      'rewrites cannot borrow effective approval',
      /only the identical approved command; changed candidates\/final commands require independent non-yolo allow/,
    ],
    ['native child policy is separate', /Native children execute under their own policy/],
    [
      'command policy is not a universal path sandbox',
      /Direct commands and mixed chains remain subject to command policy, not a universal path sandbox/,
    ],
    ['no verified savings claim', /savings remain unverified/i],
    ['explicit off survives installation', /without overwriting an existing explicit `off`/],
    [
      'Saved Models retirement preserves native configuration',
      /Saved Model Profiles is retired; native `\/model`, auth\/defaults and local roles are untouched/,
    ],
    ['state implementation owner', /\.\.\/lib\/rtk-state\.ts/],
  ] as const)
    assert.match(rtk, contract, claim)
  for (const [claim, contract] of [
    ['PSS is the sole resolver', /public permission-system \(PSS\) as the sole policy resolver/],
    ['not an OS sandbox', /not an OS sandbox/],
    [
      'path ask cannot authorize a rewritten path',
      /matched ask requires consuming a same-turn public `permissions:decision` allow for that exact surface\/path; a rewritten path cannot borrow it/,
    ],
    [
      'aggregate pipeline owns one-shot receipts',
      /aggregate successful native Bash pipeline.*bounded one-shot receipt/,
    ],
    ['receipt session identity', /Exact SessionManager object and native session ID/],
    [
      'receipt complete command identity',
      /Full toolCallId and complete original command, including heredoc body/,
    ],
    ['receipt cwd and principal', /Current cwd and the PSS-selected principal/],
    [
      'receipt consumed before transformations',
      /consumes the receipt \*\*before asynchronous transformations\*\*/,
    ],
    ['deny vetoes effective approval', /Deny always vetoes/],
    [
      'changed commands need independent allow',
      /changed original, RTK candidate or sanitizer-transformed final command needs independent \*\*non-yolo allow\*\*/,
    ],
    [
      'lifecycle revokes receipts and checkers',
      /Completion, cancellation, turn end, reload and shutdown revoke receipts and retained checkers/,
    ],
    [
      'missing approval capability fails closed',
      /Without the capability or valid receipt, Root retains raw allow checks and refuses asks/,
    ],
    [
      'direct commit bypasses only the helper',
      /Direct `git commit` bypasses the RTK helper, not commit-attribution checks/,
    ],
  ] as const)
    assert.match(guards, contract, claim)
  assert.match(text('check-public-sdk.mjs'), /rtk-patch-test\.mjs/)
})
