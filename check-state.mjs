// Read-only whole-state gate; deliberately never prunes any state.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stateRoot, measureState } from './test-state.mjs'

const root = stateRoot(path.dirname(fileURLToPath(import.meta.url)))
const result = measureState(root)
console.log(JSON.stringify({ root, ...result, requirement: 'strictly below 1 GiB' }, null, 2))
