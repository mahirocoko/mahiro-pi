import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const secret = 'SYNTHETIC_PRIVATE_PAYLOAD_NOT_FOR_DIAGNOSTICS'
test('offline entry diagnostics contain fixed codes/stages only; only apply warns about deletion', () => {
  for (const action of ['--inspect', '--apply']) {
    const result = spawnSync(process.execPath, ['memory-maintenance.mjs', '--reset', action, secret], {
      encoding: 'utf8',
      timeout: 30000,
    })
    assert.equal(result.status, 1)
    const [diagnostic] = result.stderr.trim().split('\n')
    assert.deepEqual(JSON.parse(diagnostic), {
      diagnostic: 'mahiro-offline-cli-v1',
      stage: 'arguments',
      code: 'operator-refused',
    })
    assert.equal(result.stderr.includes(secret), false)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr.includes('partially deleted'), action === '--apply')
  }
  const native = spawnSync(process.execPath, ['lib/bootstrap-native.mjs'], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, MAHIRO_BOOTSTRAP_REQUEST: secret },
  })
  assert.equal(native.status, 1)
  assert.equal(native.stdout, '')
  assert.deepEqual(JSON.parse(native.stderr), {
    diagnostic: 'mahiro-offline-native-v1',
    stage: 'request',
    code: 'native-failure',
  })
})
