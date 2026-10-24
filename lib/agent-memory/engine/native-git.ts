import { spawn } from 'node:child_process'

// Mutating Git/filter/hook work is not cancellable by the readonly helper's timeout.
// The caller performs its final live check immediately before this synchronous start.
export function startGitMutation(
  root: string,
  args:
    | ['init', '--quiet']
    | ['add', '--', ...string[]]
    | ['commit', '-m', 'Maintain private agent memory' | 'Initialize private managed memory'],
  env: NodeJS.ProcessEnv,
) {
  const child = spawn('git', ['--no-pager', ...args], {
    cwd: root,
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const started = typeof child.pid === 'number'
  const completed = new Promise<void>((resolve, reject) => {
    let failure: Error | undefined
    // No retained hook output, timeout kill, abort signal, identity/config overrides.
    child.stdout.resume()
    child.stderr.resume()
    child.once('error', (error) => {
      failure = error
    })
    child.once('close', (code, signal) => {
      if (failure) reject(failure)
      else if (code === 0 && !signal) resolve()
      else reject(Error(`Git mutation failed (${code ?? signal}); proposal/index retained`))
    })
  })
  return { started, completed }
}
