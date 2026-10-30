// Opaque relative-path token for Palace routes.
// The human path stays in text and data attributes. The URL carries only this token.
const maxPathBytes = 512
const maxSegmentBytes = 256
const maxSegments = 8

export const palacePathLimits = {
  maxPathBytes,
  maxTokenLength: 684,
} as const

const tokenPattern = /^[A-Za-z0-9_-]{1,684}$/

function refused(): never {
  throw Error('Local memory palace refused')
}

function pathRefused(): never {
  throw Error('Local memory path refused')
}

function unpairedSurrogate(path: string): boolean {
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= path.length) return true
      const next = path.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

export function assertPalacePath(path: string): void {
  if (typeof path !== 'string' || path.length === 0 || path.length > maxPathBytes) pathRefused()
  if (Buffer.byteLength(path) > maxPathBytes) pathRefused()
  if (path.includes('\0') || path.includes('\\') || path.startsWith('/') || path.endsWith('/')) pathRefused()
  if (unpairedSurrogate(path)) pathRefused()
  const parts = path.split('/')
  if (parts.length > maxSegments) pathRefused()
  for (const part of parts) {
    if (part.length === 0 || part === '.' || part === '..' || part === '.git' || part.startsWith('.'))
      pathRefused()
    if (part !== part.trim() || Buffer.byteLength(part) > maxSegmentBytes) pathRefused()
    for (let index = 0; index < part.length; index += 1) {
      const code = part.charCodeAt(index)
      if (code <= 0x1f || code === 0x7f) pathRefused()
    }
  }
}

export function encodePalacePath(path: string): string {
  assertPalacePath(path)
  const bytes = Buffer.from(path, 'utf8')
  let decoded = ''
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    pathRefused()
  }
  if (decoded !== path) pathRefused()
  const token = bytes.toString('base64url')
  if (!tokenPattern.test(token)) refused()
  return token
}

export function decodePalacePath(token: string): string {
  if (!tokenPattern.test(token)) refused()
  let bytes: Buffer
  try {
    bytes = Buffer.from(token, 'base64url')
  } catch {
    refused()
  }
  if (bytes.length === 0 || bytes.length > maxPathBytes || bytes.includes(0)) refused()
  let path: string
  try {
    path = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    refused()
  }
  if (Buffer.from(path, 'utf8').toString('base64url') !== token) refused()
  assertPalacePath(path)
  return path
}
