// Disposable installation topology; never activate a copied owner in a real profile.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { productRoot, stagePermissionFixture } from '../lib/guards/test/permission-patch-fixture.mjs'
import { stagePublicSkillFixture } from './bootstrap-skill-fixture.ts'

export async function stageBootstrapCandidate(options: { skills?: boolean } = {}) {
  const stage = stagePermissionFixture({
    evidenceBase: path.join(productRoot, '.agent-state/runtime/candidate-isolation/bootstrap'),
  })
  // Proven standalone CLI topology: no dependency symlinks inside hashed lib/.
  fs.unlinkSync(path.join(stage.primary, 'node_modules'))
  fs.renameSync(path.join(stage.adapter, 'node_modules'), path.join(stage.primary, 'node_modules'))
  if (options.skills) stagePublicSkillFixture(path.join(stage.root, 'mahiro-skills'), productRoot)
  const bootstrap = await import(pathToFileURL(path.join(stage.primary, 'lib/bootstrap.ts')).href)
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(productRoot, 'package.json'), 'utf8')).pi.extensions.length,
    13,
  )
  return {
    ...stage,
    bootstrap,
    modules: path.join(stage.primary, 'node_modules'),
  }
}
