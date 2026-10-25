// Filtered helpers derived from the immutable upstream factory in this directory.
// Only bounded inspection functions are retained; no checker, subprocess or policy engine.
import { X509Certificate } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'

const MAX_CONFIG_BYTES = 64 * 1024
const MAX_CONFIG_LINES = 500
const MAX_PAYLOAD_BYTES = 32 * 1024

const BOOLEAN_SETTINGS = new Set([
  'strict-ssl',
  'save-exact',
  'package-lock',
  'fund',
  'audit',
  'ignore-scripts',
  'legacy-peer-deps',
  'auto-install-peers',
  'prefer-offline',
  'prefer-online',
  'engine-strict',
  'dry-run',
  'shamefully-hoist',
  'hoist',
])

const ENUMERATED_SETTINGS = new Map([
  ['node-linker', new Set(['hoisted', 'isolated', 'pnp', 'pnp-loose'])],
  ['loglevel', new Set(['silent', 'error', 'warn', 'notice', 'http', 'info', 'verbose', 'silly'])],
])

const NUMBER_SETTINGS = new Set([
  'fetch-retries',
  'fetch-retry-mintimeout',
  'fetch-retry-maxtimeout',
  'fetch-timeout',
  'maxsockets',
  'depth',
])

async function readConfigFileLines(targetPath, signal) {
  if (signal?.aborted) return { status: 'error', error: 'Operation aborted.' }
  let handle
  let rawContent
  try {
    if (typeof constants.O_NOFOLLOW !== 'number') {
      return {
        status: 'error',
        error: 'Safe configuration reading is unsupported on this platform.',
      }
    }
    // Inspect and read ONE descriptor, never re-resolve a path after checking it.
    // NONBLOCK prevents a replaced FIFO/device from hanging before fstat.
    handle = await open(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    if (signal?.aborted) return { status: 'error', error: 'Operation aborted.' }
    const stat = await handle.stat()
    if (!stat.isFile()) return { status: 'error', error: 'Target is not a regular file.' }
    if (stat.size > MAX_CONFIG_BYTES)
      return {
        status: 'error',
        error: 'File exceeds maximum supported size (64KB).',
      }
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      if (signal?.aborted) return { status: 'error', error: 'Operation aborted.' }
      const { bytesRead } = await handle.read(buffer, length, Math.min(4096, buffer.length - length), length)
      if (signal?.aborted) return { status: 'error', error: 'Operation aborted.' }
      if (!bytesRead) break
      length += bytesRead
    }
    const after = await handle.stat()
    if (length > MAX_CONFIG_BYTES || after.size > MAX_CONFIG_BYTES) {
      return {
        status: 'error',
        error: 'File exceeds maximum supported size (64KB).',
      }
    }
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      return {
        status: 'error',
        error: 'Configuration changed during inspection; retry.',
      }
    }
    rawContent = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))
    if (rawContent.includes('\0')) return { status: 'error', error: 'Unsupported configuration encoding.' }
  } catch (error) {
    if (error?.code === 'ELOOP') return { status: 'error', error: 'Refusing to read symbolic link.' }
    return { status: 'error', error: 'Failed to read file.' }
  } finally {
    await handle?.close().catch(() => {})
  }
  if (signal?.aborted) return { status: 'error', error: 'Operation aborted.' }

  const lines = rawContent.split(/\r?\n/)
  if (lines.length > MAX_CONFIG_LINES) {
    return {
      status: 'error',
      error: 'File exceeds maximum line count (500 lines).',
    }
  }

  return { status: 'success', lines }
}

async function runNpmConfig(ctx) {
  if (ctx?.signal?.aborted) return { status: 'error', error: 'Operation aborted.' }
  if (
    !ctx ||
    typeof ctx.cwd !== 'string' ||
    !isAbsolute(ctx.cwd) ||
    !ctx.args ||
    typeof ctx.args !== 'object' ||
    Array.isArray(ctx.args) ||
    Object.keys(ctx.args).some((key) => key !== 'path')
  ) {
    return {
      status: 'error',
      error: 'Valid scoped cwd and config arguments are required.',
    }
  }
  const cwd = ctx.cwd
  const rawPath = ctx?.args?.path
  if (rawPath !== undefined && typeof rawPath !== 'string') {
    return { status: 'error', error: 'Argument path must be a string.' }
  }
  if (rawPath !== undefined && !rawPath) {
    return { status: 'error', error: 'Argument path must be nonempty.' }
  }
  const targetPath = rawPath === undefined ? resolve(cwd, '.npmrc') : resolve(cwd, rawPath)
  if (basename(targetPath) !== '.npmrc') {
    return {
      status: 'error',
      error: 'Target file basename must be exactly .npmrc.',
    }
  }

  const readRes = await readConfigFileLines(targetPath, ctx?.signal)
  if (readRes.status !== 'success') return readRes
  const lines = readRes.lines

  const settings = {}
  let redacted_count = 0
  const redacted_reasons = new Set()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#') || trimmed.startsWith(';')) continue
    if (line.trimEnd().endsWith('\\')) {
      return {
        status: 'error',
        error: 'Multiline continuation lines in .npmrc are not supported.',
      }
    }
    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) {
      return {
        status: 'error',
        error: "Malformed line in .npmrc without '=' separator.",
      }
    }
    const rawKey = line.slice(0, eqIdx).trim()
    let rawVal = line.slice(eqIdx + 1).trim()
    if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
      const quote = rawVal[0]
      if (!rawVal.endsWith(quote) || rawVal.length < 2) {
        return {
          status: 'error',
          error: 'Malformed quoted configuration value.',
        }
      }
      rawVal = rawVal.slice(1, -1)
    }
    if (!rawKey) {
      return {
        status: 'error',
        error: 'Malformed line in .npmrc with empty key.',
      }
    }

    const lk = rawKey.toLowerCase()

    // Auth / credential keys
    if (
      lk.includes('auth') ||
      lk.includes('token') ||
      lk.includes('password') ||
      lk.includes('secret') ||
      lk.includes('key') ||
      lk.includes('cert') ||
      lk.includes('credentials') ||
      lk.startsWith('_') ||
      lk.includes(':_')
    ) {
      redacted_count += 1
      redacted_reasons.add('credential_key')
      continue
    }

    // Boolean settings
    if (BOOLEAN_SETTINGS.has(lk)) {
      const lv = rawVal.toLowerCase()
      if (lv === 'true' || lv === 'false') {
        settings[lk] = lv === 'true'
      } else {
        redacted_count += 1
        redacted_reasons.add('invalid_boolean_value')
      }
      continue
    }

    // Enumerated settings
    if (ENUMERATED_SETTINGS.has(lk)) {
      const lv = rawVal.toLowerCase()
      if (ENUMERATED_SETTINGS.get(lk).has(lv)) {
        settings[lk] = lv
      } else {
        redacted_count += 1
        redacted_reasons.add('invalid_enumerated_value')
      }
      continue
    }

    // Number settings
    if (NUMBER_SETTINGS.has(lk)) {
      if (/^\d+$/.test(rawVal) && Number.isSafeInteger(Number(rawVal))) {
        settings[lk] = Number(rawVal)
      } else {
        redacted_count += 1
        redacted_reasons.add('invalid_number_value')
      }
      continue
    }

    // Registry settings (registry or @scope:registry)
    if (lk === 'registry' || /^@[a-z0-9_.-]+:registry$/.test(lk)) {
      try {
        const u = new URL(rawVal)
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
          redacted_count += 1
          redacted_reasons.add('unsupported_registry_protocol')
          continue
        }
        // Safe origin strips username, password, pathname, search, hash
        settings[lk] = u.origin
      } catch {
        redacted_count += 1
        redacted_reasons.add('malformed_registry_url')
      }
      continue
    }

    // Unrecognized / unvalidated setting
    redacted_count += 1
    redacted_reasons.add('unrecognized_setting')
  }

  return {
    status: 'success',
    settings,
    redacted_count,
    redacted_reasons: Array.from(redacted_reasons).sort(),
    lines_parsed: lines.length,
  }
}

function isPlaceholderLike(val) {
  if (!val) return false
  const trimmed = val.trim()
  if (!trimmed) return false
  if (
    (trimmed.startsWith('<') && trimmed.endsWith('>')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('${') && trimmed.endsWith('}'))
  ) {
    return true
  }
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return true
  if (/^[xX*.-]{3,}$/.test(trimmed)) return true
  const lower = trimmed.toLowerCase()
  if (
    /^(?:your[_-]|insert[_-]|replace[_-]|change[_-]?me|placeholder|todo|fixme|dummy[_-]|sample[_-]|example[_-])/i.test(
      lower,
    )
  )
    return true
  if (/^(?:changeme|placeholder|todo|fixme|dummy|sample|example)$/i.test(lower)) return true
  if (/(?:[_-]here|[_-]placeholder|[_-]sample|[_-]example|[_-]token|[_-]key)$/i.test(lower)) return true
  return false
}

async function runEnvConfig(ctx) {
  if (ctx?.signal?.aborted) return { status: 'error', error: 'Operation aborted.' }
  if (
    !ctx ||
    typeof ctx.cwd !== 'string' ||
    !isAbsolute(ctx.cwd) ||
    !ctx.args ||
    typeof ctx.args !== 'object' ||
    Array.isArray(ctx.args) ||
    Object.keys(ctx.args).some((key) => key !== 'path')
  ) {
    return {
      status: 'error',
      error: 'Valid scoped cwd and config arguments are required.',
    }
  }
  const cwd = ctx.cwd
  const rawPath = ctx?.args?.path
  if (rawPath !== undefined && typeof rawPath !== 'string') {
    return { status: 'error', error: 'Argument path must be a string.' }
  }
  if (rawPath !== undefined && !rawPath) {
    return { status: 'error', error: 'Argument path must be nonempty.' }
  }
  const targetPath = rawPath === undefined ? resolve(cwd, '.env') : resolve(cwd, rawPath)
  const bname = basename(targetPath).toLowerCase()
  if (bname !== '.env' && (!/^\.env\.[a-z0-9_.-]+$/i.test(bname) || bname.length > 64)) {
    return {
      status: 'error',
      error: 'Target file basename must be .env or .env.<suffix>.',
    }
  }

  const readRes = await readConfigFileLines(targetPath, ctx?.signal)
  if (readRes.status !== 'success') return readRes
  const lines = readRes.lines

  if (lines.length > 0 && lines[0].charCodeAt(0) === 0xfeff) {
    lines[0] = lines[0].slice(1)
  }

  const keyMap = new Map()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    if (line.trimEnd().endsWith('\\')) {
      return {
        status: 'error',
        error: 'Multiline continuation lines in dotenv are not supported.',
      }
    }

    let content = trimmed
    if (content.startsWith('export') && (content.length === 6 || /\s/.test(content[6]))) {
      content = content.slice(6).trimStart()
    }

    const eqIdx = content.indexOf('=')
    if (eqIdx === -1) {
      return {
        status: 'error',
        error: "Malformed line in dotenv file without '=' separator.",
      }
    }

    const rawKey = content.slice(0, eqIdx).trim()
    if (!rawKey) {
      return {
        status: 'error',
        error: 'Malformed line in dotenv file with empty key.',
      }
    }
    if (rawKey.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(rawKey)) {
      return {
        status: 'error',
        error: 'Malformed or unsupported key name in dotenv file.',
      }
    }

    const rawVal = content.slice(eqIdx + 1).trim()
    let parsedVal = ''

    if (rawVal.startsWith('"')) {
      let j = 1
      const valChars = []
      let closed = false
      while (j < rawVal.length) {
        if (rawVal[j] === '\\' && j + 1 < rawVal.length) {
          valChars.push(rawVal[j + 1])
          j += 2
          continue
        }
        if (rawVal[j] === '"') {
          closed = true
          j += 1
          break
        }
        valChars.push(rawVal[j])
        j += 1
      }
      if (!closed) {
        return {
          status: 'error',
          error: 'Malformed quoted configuration value in dotenv file.',
        }
      }
      const remainder = rawVal.slice(j).trim()
      if (remainder && !remainder.startsWith('#')) {
        return {
          status: 'error',
          error: 'Malformed content following quoted value in dotenv file.',
        }
      }
      parsedVal = valChars.join('')
    } else if (rawVal.startsWith("'")) {
      let j = 1
      const valChars = []
      let closed = false
      while (j < rawVal.length) {
        if (rawVal[j] === "'") {
          closed = true
          j += 1
          break
        }
        valChars.push(rawVal[j])
        j += 1
      }
      if (!closed) {
        return {
          status: 'error',
          error: 'Malformed quoted configuration value in dotenv file.',
        }
      }
      const remainder = rawVal.slice(j).trim()
      if (remainder && !remainder.startsWith('#')) {
        return {
          status: 'error',
          error: 'Malformed content following quoted value in dotenv file.',
        }
      }
      parsedVal = valChars.join('')
    } else {
      // Unquoted # starts a comment, including an otherwise empty value.
      // Quotes inside comment prose are not part of the value grammar.
      const commentIndex = rawVal.indexOf('#')
      const value = (commentIndex === -1 ? rawVal : rawVal.slice(0, commentIndex)).trim()
      if (value.includes('"') || value.includes("'")) {
        return { status: 'error', error: 'Malformed quoting in dotenv file.' }
      }
      parsedVal = value
    }

    const present = parsedVal.length > 0
    const placeholder_like = present ? isPlaceholderLike(parsedVal) : false

    keyMap.set(rawKey, {
      name: rawKey,
      present,
      placeholder_like,
    })
  }

  const result = {
    status: 'success',
    keys: Array.from(keyMap.values()),
    lines_parsed: lines.length,
  }

  if (Buffer.byteLength(JSON.stringify(result)) > MAX_PAYLOAD_BYTES) {
    return {
      status: 'error',
      error: 'Output exceeds maximum supported size (32KB).',
    }
  }

  return result
}

async function runPypiConfig(ctx) {
  if (ctx?.signal?.aborted) return { status: 'error', error: 'Operation aborted.' }
  if (
    !ctx ||
    typeof ctx.cwd !== 'string' ||
    !isAbsolute(ctx.cwd) ||
    !ctx.args ||
    typeof ctx.args !== 'object' ||
    Array.isArray(ctx.args) ||
    Object.keys(ctx.args).some((key) => key !== 'path')
  ) {
    return {
      status: 'error',
      error: 'Valid scoped cwd and config arguments are required.',
    }
  }
  const cwd = ctx.cwd
  const rawPath = ctx?.args?.path
  if (rawPath !== undefined && typeof rawPath !== 'string') {
    return { status: 'error', error: 'Argument path must be a string.' }
  }
  if (rawPath !== undefined && !rawPath) {
    return { status: 'error', error: 'Argument path must be nonempty.' }
  }
  const targetPath = rawPath === undefined ? resolve(cwd, '.pypirc') : resolve(cwd, rawPath)
  if (basename(targetPath) !== '.pypirc') {
    return {
      status: 'error',
      error: 'Target file basename must be exactly .pypirc.',
    }
  }

  const readRes = await readConfigFileLines(targetPath, ctx?.signal)
  if (readRes.status !== 'success') return readRes
  const lines = readRes.lines

  if (lines.length > 0 && lines[0].charCodeAt(0) === 0xfeff) {
    lines[0] = lines[0].slice(1)
  }

  let currentSection = null
  const indexServers = []
  const repositories = new Map()
  let redacted_count = 0
  const redacted_reasons = new Set()
  let inMultilineIndexServers = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isIndented = line.startsWith(' ') || line.startsWith('\t')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue

    if (line.trimEnd().endsWith('\\')) {
      return {
        status: 'error',
        error: 'Multiline continuation lines in .pypirc are not supported.',
      }
    }

    if (isIndented) {
      if (inMultilineIndexServers && currentSection === 'distutils') {
        const entries = trimmed.split(/[\s,]+/).filter(Boolean)
        for (const entry of entries) {
          if (!/^[a-zA-Z0-9_.-]+$/.test(entry) || entry.length > 64) {
            return {
              status: 'error',
              error: 'Malformed index-servers entry in .pypirc.',
            }
          }
          if (!indexServers.includes(entry)) {
            indexServers.push(entry)
          }
        }
        continue
      }
      return { status: 'error', error: 'Unexpected indented line in .pypirc.' }
    }

    inMultilineIndexServers = false

    if (trimmed.startsWith('[')) {
      if (!trimmed.endsWith(']') || trimmed.indexOf(']', 1) !== trimmed.length - 1) {
        return {
          status: 'error',
          error: 'Malformed section header in .pypirc.',
        }
      }
      const secName = trimmed.slice(1, -1).trim()
      if (!secName || !/^[a-zA-Z0-9_.-]+$/.test(secName) || secName.length > 64) {
        return {
          status: 'error',
          error: 'Malformed section header in .pypirc.',
        }
      }
      currentSection = secName
      if (currentSection !== 'distutils' && !repositories.has(currentSection)) {
        repositories.set(currentSection, {})
      }
      continue
    }

    if (currentSection === null) {
      return {
        status: 'error',
        error: 'Properties found outside section in .pypirc.',
      }
    }

    const eqIdx = trimmed.search(/[=:]/)
    if (eqIdx === -1) {
      return {
        status: 'error',
        error: 'Malformed line in .pypirc without separator.',
      }
    }

    const rawKey = trimmed.slice(0, eqIdx).trim()
    let rawVal = trimmed.slice(eqIdx + 1).trim()
    if (!rawKey || !/^[a-zA-Z0-9_.-]+$/.test(rawKey) || rawKey.length > 64) {
      return { status: 'error', error: 'Malformed key name in .pypirc.' }
    }

    const lk = rawKey.toLowerCase()

    if (currentSection === 'distutils') {
      if (lk === 'index-servers') {
        inMultilineIndexServers = true
        if (rawVal) {
          const entries = rawVal.split(/[\s,]+/).filter(Boolean)
          for (const entry of entries) {
            if (!/^[a-zA-Z0-9_.-]+$/.test(entry) || entry.length > 64) {
              return {
                status: 'error',
                error: 'Malformed index-servers entry in .pypirc.',
              }
            }
            if (!indexServers.includes(entry)) {
              indexServers.push(entry)
            }
          }
        }
      } else {
        redacted_count += 1
        redacted_reasons.add('unrecognized_setting')
      }
      continue
    }

    // Repository profile section
    if (
      lk === 'username' ||
      lk === 'password' ||
      lk === 'token' ||
      lk.includes('auth') ||
      lk.includes('token') ||
      lk.includes('password') ||
      lk.includes('secret') ||
      lk.includes('key') ||
      lk.includes('credentials')
    ) {
      redacted_count += 1
      redacted_reasons.add('credential_key')
      continue
    }

    if (lk === 'repository') {
      if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
        const q = rawVal[0]
        if (!rawVal.endsWith(q) || rawVal.length < 2) {
          return {
            status: 'error',
            error: 'Malformed quoted configuration value in .pypirc.',
          }
        }
        rawVal = rawVal.slice(1, -1)
      }
      try {
        const u = new URL(rawVal)
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
          redacted_count += 1
          redacted_reasons.add('unsupported_repository_protocol')
          continue
        }
        repositories.get(currentSection).repository = u.origin
      } catch {
        redacted_count += 1
        redacted_reasons.add('malformed_repository_url')
      }
      continue
    }

    redacted_count += 1
    redacted_reasons.add('unrecognized_setting')
  }

  const result = {
    status: 'success',
    index_servers: indexServers,
    // fromEntries defines OWN properties even for __proto__/constructor; no
    // arbitrary section name is ever assigned through a prototype setter.
    repositories: Object.fromEntries(repositories),
    redacted_count,
    redacted_reasons: Array.from(redacted_reasons).sort(),
    lines_parsed: lines.length,
  }

  if (Buffer.byteLength(JSON.stringify(result)) > MAX_PAYLOAD_BYTES) {
    return {
      status: 'error',
      error: 'Output exceeds maximum supported size (32KB).',
    }
  }

  return result
}

const MAX_CERTIFICATE_BLOCKS = 16

async function runCertificateInfo(ctx) {
  if (ctx?.signal?.aborted) return { status: 'error', error: 'Operation aborted.' }
  if (
    !ctx ||
    typeof ctx.cwd !== 'string' ||
    !isAbsolute(ctx.cwd) ||
    !ctx.args ||
    typeof ctx.args !== 'object' ||
    Array.isArray(ctx.args) ||
    Object.keys(ctx.args).some((key) => key !== 'path')
  ) {
    return {
      status: 'error',
      error: 'Valid scoped cwd and certificate arguments are required.',
    }
  }
  const rawPath = ctx?.args?.path
  if (typeof rawPath !== 'string') {
    return { status: 'error', error: 'Argument path must be a string.' }
  }
  if (!rawPath) {
    return { status: 'error', error: 'Argument path must be nonempty.' }
  }
  if (rawPath.includes('\0')) {
    return {
      status: 'error',
      error: 'Argument path contains invalid characters.',
    }
  }
  const targetPath = resolve(ctx.cwd, rawPath)
  const targetBasename = basename(targetPath).toLowerCase()
  if (!targetBasename.endsWith('.pem')) {
    return { status: 'error', error: 'Target file basename must end in .pem.' }
  }

  const readRes = await readConfigFileLines(targetPath, ctx?.signal)
  if (readRes.status !== 'success') return readRes
  const lines = readRes.lines

  if (lines.length > 0 && lines[0].charCodeAt(0) === 0xfeff) {
    lines[0] = lines[0].slice(1)
  }

  const certificates = []
  let inBlock = false
  let currentBase64Lines = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!inBlock) {
      if (!trimmed) continue
      if (trimmed === '-----BEGIN CERTIFICATE-----') {
        if (certificates.length >= MAX_CERTIFICATE_BLOCKS) {
          return {
            status: 'error',
            error: 'Certificate chain exceeds maximum supported limit (16 certificates).',
          }
        }
        inBlock = true
        currentBase64Lines = []
        continue
      }
      return { status: 'error', error: 'Invalid certificate format.' }
    } else {
      if (trimmed === '-----END CERTIFICATE-----') {
        if (currentBase64Lines.length === 0) {
          return { status: 'error', error: 'Invalid certificate format.' }
        }
        const b64 = currentBase64Lines.join('')
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) {
          return { status: 'error', error: 'Invalid certificate format.' }
        }
        let der
        try {
          der = Buffer.from(b64, 'base64')
        } catch {
          return { status: 'error', error: 'Invalid certificate format.' }
        }
        if (der.toString('base64') !== b64) {
          return { status: 'error', error: 'Invalid certificate format.' }
        }
        let cert
        try {
          cert = new X509Certificate(der)
        } catch {
          return { status: 'error', error: 'Invalid certificate format.' }
        }
        if (!cert.raw || !der.equals(cert.raw)) {
          return { status: 'error', error: 'Invalid certificate format.' }
        }
        certificates.push({
          subject: cert.subject,
          issuer: cert.issuer,
          valid_from: cert.validFrom,
          valid_to: cert.validTo,
          fingerprint256: cert.fingerprint256,
          serial_number: cert.serialNumber.toUpperCase(),
        })
        inBlock = false
        currentBase64Lines = []
        continue
      }

      if (!trimmed || !/^[A-Za-z0-9+/]+=*$/.test(trimmed)) {
        return { status: 'error', error: 'Invalid certificate format.' }
      }
      currentBase64Lines.push(trimmed)
    }
  }

  if (inBlock) {
    return { status: 'error', error: 'Invalid certificate format.' }
  }

  if (certificates.length === 0) {
    return { status: 'error', error: 'No certificates found in target file.' }
  }

  const result = {
    status: 'success',
    certificates,
    certificate_count: certificates.length,
  }

  if (Buffer.byteLength(JSON.stringify(result)) > MAX_PAYLOAD_BYTES) {
    return {
      status: 'error',
      error: 'Output exceeds maximum supported size (32KB).',
    }
  }

  if (ctx?.signal?.aborted) return { status: 'error', error: 'Operation aborted.' }

  return result
}

const NPM_CONFIG_TOOL = {
  name: 'mh_npm_config',
  description: 'Inspect workspace .npmrc configuration with auth and sensitive tokens strictly filtered out.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to .npmrc file (optional, defaults to .npmrc in workspace cwd). Basename must be exactly .npmrc.',
      },
    },
    additionalProperties: false,
  },
  requiresApproval: false,
  parallelSafe: true,
  run: (ctx) => runNpmConfig(ctx),
}

const ENV_CONFIG_TOOL = {
  name: 'mh_env_config',
  description: 'Inspect workspace dotenv (.env) configuration keys and presence without exposing values.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to .env file (optional, defaults to .env in workspace cwd). Basename must be .env or .env.<suffix>.',
      },
    },
    additionalProperties: false,
  },
  requiresApproval: false,
  parallelSafe: true,
  run: (ctx) => runEnvConfig(ctx),
}

const PYPI_CONFIG_TOOL = {
  name: 'mh_pypi_config',
  description:
    'Inspect workspace PyPI configuration (.pypirc) with auth tokens and passwords strictly filtered out.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to .pypirc file (optional, defaults to .pypirc in workspace cwd). Basename must be exactly .pypirc.',
      },
    },
    additionalProperties: false,
  },
  requiresApproval: false,
  parallelSafe: true,
  run: (ctx) => runPypiConfig(ctx),
}

const CERTIFICATE_INFO_TOOL = {
  name: 'mh_certificate_info',
  description:
    'Inspect public X.509 certificate metadata from a .pem file safely without exposing raw PEM or private keys.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to .pem certificate file. Basename must end in .pem (case-insensitive).',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  requiresApproval: false,
  parallelSafe: true,
  run: (ctx) => runCertificateInfo(ctx),
}

export function createFilteredTools(signal) {
  const definitions = [NPM_CONFIG_TOOL, ENV_CONFIG_TOOL, PYPI_CONFIG_TOOL, CERTIFICATE_INFO_TOOL]
  return new Map(
    definitions.map((tool) => [
      tool.name,
      {
        ...tool,
        run(ctx) {
          if (signal?.aborted || ctx?.signal?.aborted) return { status: 'error', error: 'Operation aborted.' }
          return tool.run({ ...ctx, signal: AbortSignal.any([signal, ctx?.signal].filter(Boolean)) })
        },
      },
    ]),
  )
}
export const __testing = { runNpmConfig, runEnvConfig, runPypiConfig, runCertificateInfo }
