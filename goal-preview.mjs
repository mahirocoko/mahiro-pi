import { previewGoalConfiguration } from './lib/goal/store.ts'

// Source-only preview: deliberately no apply flag or profile mutation path.
try {
  const args = process.argv.slice(2),
    projects = []
  let profile
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: pnpm goal:preview --project /canonical/project [--project /other/project] [--agent-dir /canonical/private/profile]\nPreview only: no config, grant, Goal, state, directory, install or reload is performed.',
    )
  } else {
    for (let index = 0; index < args.length; index++) {
      const flag = args[index],
        value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('Explicit path required')
      if (flag === '--project') projects.push(value)
      else if (flag === '--agent-dir' && profile === undefined) profile = value
      else throw new Error('Unsupported or duplicate preview flag; no apply operation exists')
    }
    if (!projects.length)
      throw new Error('At least one explicit project required; no automatic project selection')
    console.log(JSON.stringify(previewGoalConfiguration(projects, profile), null, 2))
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Goal preview unavailable')
  process.exitCode = 1
}
