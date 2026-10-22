import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const base = path.resolve('.agent-state/runtime/evidence-port/fixtures')
fs.mkdirSync(base, { recursive: true, mode: 0o700 })
export async function fixture() {
  const root = fs.mkdtempSync(path.join(base, 'offline-')),
    primary = path.join(root, 'primary'),
    profile = path.join(root, 'profile'),
    project = path.join(root, 'project')
  for (const dir of [primary, profile, project]) fs.mkdirSync(dir, { mode: 0o700 })
  fs.cpSync(path.resolve('lib'), path.join(primary, 'lib'), {
    recursive: true,
  })
  const config = path.join(profile, 'extensions/mahiro-code-evidence/config.json')
  fs.mkdirSync(path.dirname(config), { recursive: true, mode: 0o700 })
  fs.writeFileSync(config, JSON.stringify({ version: 1, profile, projects: [project] }), { mode: 0o600 })
  process.env.PI_CODING_AGENT_DIR = profile
  process.env.HOME = root
  const s = await import(pathToFileURL(path.join(primary, 'lib/evidence/store.ts')).href),
    m = await import(pathToFileURL(path.join(primary, 'lib/evidence/model.ts')).href)
  const b = {
      ...s.resolveEvidenceBinding(project),
      sessionId: 'native-session-fixture',
    },
    target = path.join(b.root, 'state.json')
  // Structurally valid deterministic report for store-only tests; not Git proof.
  const lane = () => m.capLane([], null, '')
  const synthetic = () => {
    const staged = lane(),
      unstaged = lane(),
      untracked = lane(),
      headCommit = 'a'.repeat(40)
    return {
      collectionId: `collection-fixture-${Date.now()}`,
      requestedWorkspace: project,
      repositoryRoot: project,
      branch: null,
      headCommit,
      baseCommit: null,
      baseSource: 'none',
      baseReference: null,
      collectedAt: new Date().toISOString(),
      staged,
      unstaged,
      untracked,
      baseToHead: null,
      fingerprint: m.collectionFingerprint(headCommit, null, staged, unstaged, untracked, null),
    }
  }
  const seed = () =>
    s.transactEvidence(
      b,
      s.stateTicket(s.readEvidenceState(b)),
      () => {},
      (state: any) => m.collectReport(state, b, synthetic()),
    )
  return {
    root,
    primary,
    profile,
    project,
    config,
    s,
    m,
    b,
    target,
    synthetic,
    seed,
  }
}

// Only Git-contract tests pay for repository initialization and real commits.
export async function gitFixture() {
  const f = await fixture()
  const g = await import(pathToFileURL(path.join(f.primary, 'lib/evidence/git.ts')).href)
  const git = (...args: string[]) =>
    execFileSync('/usr/bin/git', args, {
      cwd: f.project,
      encoding: 'utf8',
      env: { HOME: f.root, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1' },
    })
  git('init', '-q')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.test')
  fs.writeFileSync(path.join(f.project, 'tracked'), 'initial\n')
  git('add', '.')
  git('commit', '-qm', 'initial')
  return { ...f, g, git }
}

export function saveEnv() {
  const agent = process.env.PI_CODING_AGENT_DIR,
    home = process.env.HOME
  return () => {
    if (agent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = agent
    if (home === undefined) delete process.env.HOME
    else process.env.HOME = home
  }
}
