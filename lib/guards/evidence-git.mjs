// Narrow Evidence ABI grammar, NOT a shell execution API. It authorizes only
// the source collector's fixed argv; the collector executes original argv shell:false.
export const evidenceGitPrefix = Object.freeze([
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.excludesFile=/dev/null',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'submodule.recurse=false',
  '-c',
  'diff.submodule=short',
  '-c',
  'protocol.allow=never',
])
export const evidencePreflight =
  '^(filter\\..*\\.(clean|process|smudge)|remote\\..*\\.promisor|extensions\\.partialclone|core\\.(worktree|alternaterefscommand)|extensions\\.worktreeconfig)$'
const oid = (text) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(text)
const selection = (words) => {
  if (!words.length || words.length % 2 || words.join('\0').length > 120000) return false
  for (let i = 0; i < words.length; i += 2) {
    if (!words[i].startsWith(':(top,literal)')) return false
    const path = words[i].slice(14)
    if (
      !path ||
      path.startsWith('/') ||
      path.includes('\0') ||
      path.split('/').some((part) => !part || part === '.' || part === '..') ||
      words[i + 1] !== `:(top,literal,exclude)${path}/`
    )
      return false
  }
  return true
}
const ref = (text) =>
  typeof text === 'string' &&
  text.length > 0 &&
  text.length <= 200 &&
  !text.startsWith('-') &&
  !/[\x00-\x20\x7f]/.test(text)
export function evidenceGitCommand(executable, args) {
  if (
    executable !== '/usr/bin/git' ||
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== 'string') ||
    JSON.stringify(args.slice(0, evidenceGitPrefix.length)) !== JSON.stringify(evidenceGitPrefix)
  )
    throw Error('Evidence Git fixed executable/prefix required')
  const tail = args.slice(evidenceGitPrefix.length),
    same = (value) => JSON.stringify(tail) === JSON.stringify(value)
  let valid =
    same(['rev-parse', '--show-toplevel']) ||
    same(['branch', '--show-current']) ||
    same(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']) ||
    same(['config', '--name-only', '--get-regexp', evidencePreflight]) ||
    same(['ls-files', '--cached', '-z', '--']) ||
    (tail.length === 4 && tail[0] === 'ls-tree' && tail[1] === '-r' && tail[2] === '-z' && oid(tail[3]))
  if (
    tail.length === 4 &&
    tail[0] === 'rev-parse' &&
    tail[1] === '--verify' &&
    tail[2] === '--end-of-options' &&
    tail[3].endsWith('^{commit}') &&
    ref(tail[3].slice(0, -9))
  )
    valid = true
  if (tail.length === 3 && tail[0] === 'merge-base' && oid(tail[1]) && oid(tail[2])) valid = true
  if (
    JSON.stringify(tail.slice(0, 5)) ===
      JSON.stringify(['ls-files', '--others', '--exclude-standard', '-z', '--']) &&
    selection(tail.slice(5))
  )
    valid = true
  const separator = tail.indexOf('--')
  if (
    tail[0] === 'diff' &&
    tail[1] === '--no-ext-diff' &&
    tail[2] === '--no-textconv' &&
    tail[3] === '--no-renames' &&
    separator > 3 &&
    selection(tail.slice(separator + 1))
  ) {
    let body = tail.slice(4, separator)
    if (body[0] === '--cached') body = body.slice(1)
    else if (oid(body[0]) && oid(body[1])) body = body.slice(2)
    if (
      JSON.stringify(body) === '["--name-status","-z"]' ||
      JSON.stringify(body) === '["--shortstat"]' ||
      JSON.stringify(body) === '["--binary"]'
    )
      valid = true
  }
  if (!valid) throw Error('Evidence Git argv outside exact fixed grammar')
  // Literal single-quote representation, classified by existing host and public
  // permission service, NEVER passed to a shell or used to reconstruct argv.
  return [executable, ...args].map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(' ')
}
