import { realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'

// These are file operands, never arbitrary query, prompt or file-content text.
// Shell/interpreter execution remains PSS's domain, not a pretend sandbox.
const FILE_READS = new Set(['read', 'grep', 'find', 'find_files', 'ls', 'list_dir'])
const PRIVATE_NAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  'auth.json',
  'credentials',
  'credentials.json',
  'credentials.yaml',
  'credentials.yml',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
])

export function isSecretPath(target) {
  const normalized = target.replaceAll('\\', '/').toLowerCase()
  const name = basename(normalized)
  return (
    name.startsWith('.env') ||
    PRIVATE_NAMES.has(name) ||
    /\.(?:key|p12|pfx|pem)$/.test(name) ||
    /(?:^|\/)\.(?:ssh|aws|gnupg)(?:\/|$)/.test(normalized)
  )
}

export function assertSecretPaths(name, args, cwd) {
  if (!FILE_READS.has(name)) return
  const operand = args?.path ?? (name === 'read' ? undefined : cwd)
  if (typeof operand !== 'string' || operand.includes('\0') || !isAbsolute(cwd))
    throw Error('Secret path check requires a valid scoped file operand')
  const lexical = resolve(cwd, operand)
  if (isSecretPath(lexical))
    throw Error('Secret file read blocked; use the filtered config/certificate tool where applicable')
  try {
    if (isSecretPath(realpathSync(lexical)))
      throw Error('Secret file alias read blocked; use a filtered inspection tool')
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error?.code)) throw error
  }
}
