// Test-only Git subprocess boundary. Never inherit repository/config redirects.
import fs from 'node:fs'
import { devNull } from 'node:os'

export function gitFixtureEnv(ceiling, inherited = process.env) {
  return {
    ...Object.fromEntries(Object.entries(inherited).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CEILING_DIRECTORIES: fs.realpathSync(ceiling),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: '0',
  }
}
