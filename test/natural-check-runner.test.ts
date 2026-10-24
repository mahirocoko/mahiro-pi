import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import test from 'node:test'
import { runNaturalCheck } from '../lib/guards/test/natural-check-runner.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'natural-check-'))
  fs.chmodSync(root, 0o700)
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      setImmediate(callback)
    },
  })
  return {
    root,
    options: { logPath: path.join(root, 'child.log'), stdout: output, stderr: output },
    clean: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

test('oversized output is capped but drained through delayed marker and natural close before failure', async () => {
  const f = fixture()
  try {
    const marker = path.join(f.root, 'naturally-finished')
    const source = `
      const fs = require('node:fs')
      const chunk = Buffer.alloc(65536, 'x')
      for (let n = 0; n < 64; n++) fs.writeSync(1, chunk)
      fs.writeSync(2, 'stderr-after-cap')
      setTimeout(() => {
        fs.writeSync(1, 'DELAYED-FINAL-MARKER')
        fs.writeFileSync(process.argv[1], 'natural')
      }, 75)
    `
    const result = await runNaturalCheck(process.execPath, ['-e', source, marker], {
      ...f.options,
      logBytes: 1024,
      consoleBytes: 512,
    })
    assert.equal(result.status, 0)
    assert.equal(result.signal, null)
    assert.equal(result.error, '')
    assert.equal(result.timeoutMs, null)
    assert.equal(result.outputDrained, true)
    assert.equal(result.bytesDrained, 64 * 65536 + Buffer.byteLength('stderr-after-capDELAYED-FINAL-MARKER'))
    assert.equal(fs.readFileSync(marker, 'utf8'), 'natural')
    assert.equal(result.captureTruncated, true)
    assert.equal(result.consoleTruncated, true)
    assert.equal(result.ok, false)
    assert.equal(fs.statSync(f.options.logPath).size, 1024)
    assert.equal(fs.statSync(f.options.logPath).mode & 0o777, 0o600)
    assert.equal(result.consoleBytesWritten, 512)
  } finally {
    f.clean()
  }
})

test('success waits for console callbacks; nonzero and failed spawn cannot pass', async () => {
  for (const code of [0, 7]) {
    const f = fixture()
    try {
      const result = await runNaturalCheck(
        process.execPath,
        ['-e', `console.log('final'); process.exitCode=${code}`],
        f.options,
      )
      assert.equal(result.status, code)
      assert.equal(result.outputDrained, true)
      assert.equal(result.ok, code === 0)
      assert.equal(fs.readFileSync(f.options.logPath, 'utf8'), 'final\n')
    } finally {
      f.clean()
    }
  }
  const f = fixture()
  try {
    const result = await runNaturalCheck(path.join(f.root, 'absent-command'), [], f.options)
    assert.equal(result.ok, false)
    assert.notEqual(result.status, 0)
    assert.match(result.error, /ENOENT/)
    assert.equal(result.pid, null)
    assert.equal(result.signal, null)
  } finally {
    f.clean()
  }
})

test('log open/write and console errors fail only after child settlement and drain', async () => {
  for (const failure of ['open', 'write', 'console']) {
    const f = fixture()
    let originalWrite: typeof fs.writeSync | undefined
    try {
      const marker = path.join(f.root, 'settled')
      if (failure === 'open') fs.mkdirSync(f.options.logPath)
      if (failure === 'write') {
        originalWrite = fs.writeSync
        fs.writeSync = (() => {
          throw new Error('synthetic log failure')
        }) as typeof fs.writeSync
      }
      if (failure === 'console') {
        f.options.stdout = f.options.stderr = new Writable({
          write(_chunk, _encoding, callback) {
            callback(new Error('synthetic console failure'))
          },
        })
      }
      const result = await runNaturalCheck(
        process.execPath,
        [
          '-e',
          `
        console.log('output')
        setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'settled'), 25)
      `,
          marker,
        ],
        f.options,
      )
      assert.equal(result.status, 0)
      assert.equal(result.signal, null)
      assert.equal(result.outputDrained, true)
      assert.equal(result.ok, false)
      assert.ok(result.ioErrors.length > 0)
      assert.equal(fs.readFileSync(marker, 'utf8'), 'settled')
    } finally {
      if (originalWrite) fs.writeSync = originalWrite
      f.clean()
    }
  }
})
