import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COPY_CODE_COMMAND,
  type CopyBranchEntry,
  type CopyCodeDeps,
  copyCommandConflict,
  createCopyCodeHandler,
  handleCopyCode,
  parseCopyTargets,
} from '../lib/copy-code.ts'
import { registerNativeUtilities } from '../lib/native-utilities.ts'

const SECRET = 'HIDDEN_COPY_PAYLOAD_9f3a'

function assistant(text: string, message: Record<string, unknown> = {}): CopyBranchEntry {
  return {
    type: 'message',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      ...message,
    },
  }
}

function entry(message: CopyBranchEntry['message']): CopyBranchEntry {
  return { type: 'message', message }
}

async function run(options: {
  entries: CopyBranchEntry[]
  mode?: string
  commands?: { name: string; source?: string }[]
  parse?: CopyCodeDeps['parse']
  copyText?: (text: string) => Promise<void>
  drive?: (component: {
    render(width: number): string[]
    handleInput(data: string): void
  }) => void | Promise<void>
  commandsThrow?: boolean
  branchThrow?: boolean
}) {
  const notices: string[] = []
  const copied: string[] = []
  let editorWrites = 0
  let editorPastes = 0
  let customCalls = 0
  let overlay: { overlay?: boolean } | undefined
  const deps: CopyCodeDeps = {
    commands: () => {
      if (options.commandsThrow) throw new Error('registry down')
      return options.commands ?? [{ name: COPY_CODE_COMMAND, source: 'extension' }]
    },
    copyText:
      options.copyText ??
      (async (text) => {
        copied.push(text)
      }),
    parse: options.parse,
  }
  const ctx = {
    mode: options.mode ?? 'tui',
    sessionManager: {
      getBranch: () => {
        if (options.branchThrow) throw new Error('branch down')
        return options.entries
      },
    },
    ui: {
      notify(message: string) {
        notices.push(message)
      },
      setEditorComponent() {
        editorWrites += 1
      },
      pasteToEditor() {
        editorPastes += 1
      },
      setEditorText() {
        editorPastes += 1
      },
      async custom(
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: { matches(data: string, action: string): boolean },
          done: () => void,
        ) => {
          render(width: number): string[]
          handleInput(data: string): void
        },
        dialog?: { overlay?: boolean },
      ) {
        customCalls += 1
        overlay = dialog
        let finish = () => {}
        const finished = new Promise<void>((resolve) => {
          finish = resolve
        })
        const component = factory(
          {},
          {},
          {
            matches: (data, action) => data === action,
          },
          () => finish(),
        )
        if (options.drive) await options.drive(component)
        else component.handleInput('tui.select.confirm')
        await finished
      },
    },
  }
  await handleCopyCode(ctx as never, deps)
  return {
    notices,
    copied,
    editorWrites,
    editorPastes,
    customCalls,
    overlay,
  }
}

test('fences cover closed, unclosed, multiple, empty and non-fence replies', () => {
  const plain = parseCopyTargets([assistant('plain answer')])
  assert.deepEqual(
    plain.map((target) => target.kind),
    ['response'],
  )
  assert.equal(plain[0]?.text, 'plain answer')

  const unclosed = parseCopyTargets([assistant('before\n```py\nprint(1)\nprint(2)')])
  assert.equal(unclosed[1]?.closed, false)
  assert.equal(unclosed[1]?.language, 'py')
  assert.equal(unclosed[1]?.text, 'print(1)\nprint(2)')

  const mixed = parseCopyTargets([assistant('intro\n```js\r\nconst a = 1\r\n```\r\n~~~\r\nstill open')])
  assert.deepEqual(
    mixed
      .filter((target) => target.kind === 'block')
      .map((target) => ({
        language: target.language ?? '',
        closed: target.closed,
        text: target.text,
      })),
    [
      { language: 'js', closed: true, text: 'const a = 1' },
      { language: '', closed: false, text: 'still open' },
    ],
  )
  assert.equal(mixed[0]?.text.includes('```js'), true)

  const indented = parseCopyTargets([assistant('    ```\nnot a fence')])
  assert.equal(indented.filter((target) => target.kind === 'block').length, 0)

  const skipped = parseCopyTargets([
    entry({
      role: 'user',
      content: 'user draft\nwith image',
    }),
    entry({
      role: 'assistant',
      stopReason: 'aborted',
      content: [],
    }),
    entry({
      role: 'assistant',
      content: [{ type: 'text', text: '   \n' }],
    }),
    entry({
      role: 'assistant',
      stopReason: 'aborted',
      content: [{ type: 'text', text: 'partial' }],
    }),
    entry({
      role: 'assistant',
      content: [
        { type: 'thinking', text: 'secret thought' },
        { type: 'text', text: 'visible' },
        { type: 'toolCall' },
      ],
    }),
    { type: 'custom' },
  ])
  assert.deepEqual(
    skipped.map((target) => target.text),
    ['partial', 'visible'],
  )
  assert.equal(JSON.stringify(skipped).includes('secret thought'), false)
})

test('repeated picker renders keep the parse from open time', async () => {
  let parses = 0
  const text = `\`\`\`ts\nconst visible = 1\n${SECRET}\n\`\`\``
  const renders: string[][] = []
  const result = await run({
    entries: [assistant(text)],
    parse(entries) {
      parses += 1
      return parseCopyTargets(entries)
    },
    async drive(component) {
      renders.push(component.render(72))
      renders.push(component.render(72))
      component.handleInput('tui.select.down')
      renders.push(component.render(72))
      renders.push(component.render(30))
      component.handleInput('tui.select.confirm')
    },
  })
  assert.equal(parses, 1)
  assert.deepEqual(renders[0], renders[1])
  assert.equal(renders.join('\n').includes(SECRET), false)
  assert.equal(result.copied.length, 1)
  assert.equal(result.copied[0], `const visible = 1\n${SECRET}`)
  assert.equal(result.notices.join('\n').includes(SECRET), false)
  assert.match(result.notices[0] ?? '', /Copied Response 1 · block 1 ts closed/)
  assert.equal(result.editorWrites, 0)
  assert.equal(result.editorPastes, 0)
  assert.equal(result.overlay?.overlay, true)
})

test('branch navigation reads the branch supplied at open, and cancel copies nothing', async () => {
  const first = await run({
    entries: [assistant('ALPHA_ONLY\nsecond line')],
  })
  assert.equal(first.copied[0], 'ALPHA_ONLY\nsecond line')
  const second = await run({
    entries: [assistant(`BETA_ONLY\n\`\`\`js\nconst b = 1\n${SECRET}\n\`\`\``)],
    drive(component) {
      component.handleInput('tui.select.down')
      component.handleInput('tui.select.confirm')
    },
  })
  assert.equal(second.copied[0], `const b = 1\n${SECRET}`)
  assert.equal(second.copied[0]?.includes('ALPHA_ONLY'), false)
  const cancelled = await run({
    entries: [assistant(SECRET)],
    drive(component) {
      component.handleInput('tui.select.cancel')
    },
  })
  assert.deepEqual(cancelled.copied, [])
  assert.deepEqual(cancelled.notices, [])
})

test('non-TUI modes report counts and do not touch the clipboard or editor', async () => {
  for (const mode of ['print', 'json', 'rpc']) {
    const result = await run({
      mode,
      entries: [assistant(`plain\n${SECRET}`), assistant('```js\nconst a = 1\n```')],
    })
    assert.equal(result.copied.length, 0, mode)
    assert.equal(result.customCalls, 0, mode)
    assert.equal(result.editorWrites, 0, mode)
    assert.match(result.notices[0] ?? '', /2 responses and 1 code block/)
    assert.match(result.notices[0] ?? '', /Clipboard was not changed/)
    assert.equal(result.notices.join('').includes(SECRET), false, mode)
    assert.equal(result.notices.join('').includes('const a = 1'), false, mode)
  }
})

test('registry collisions, a missing branch and clipboard failure do not leak text', async () => {
  assert.notEqual(COPY_CODE_COMMAND, 'copy')
  assert.equal(copyCommandConflict([{ name: COPY_CODE_COMMAND, source: 'extension' }]), undefined)
  assert.match(
    copyCommandConflict([
      { name: `${COPY_CODE_COMMAND}:1`, source: 'extension' },
      { name: `${COPY_CODE_COMMAND}:2`, source: 'extension' },
    ]) ?? '',
    /not a single/,
  )
  assert.match(
    copyCommandConflict([
      { name: COPY_CODE_COMMAND, source: 'extension' },
      { name: COPY_CODE_COMMAND, source: 'prompt' },
    ]) ?? '',
    /not a single/,
  )

  const collided = await run({
    entries: [assistant(SECRET)],
    commands: [
      { name: `${COPY_CODE_COMMAND}:1`, source: 'extension' },
      { name: `${COPY_CODE_COMMAND}:2`, source: 'extension' },
    ],
  })
  assert.deepEqual(collided.copied, [])
  assert.equal(collided.customCalls, 0)
  assert.match(collided.notices[0] ?? '', /not a single/)
  assert.equal(collided.notices.join('').includes(SECRET), false)

  const unavailable = await run({
    entries: [assistant(SECRET)],
    commandsThrow: true,
  })
  assert.deepEqual(unavailable.copied, [])
  assert.match(unavailable.notices[0] ?? '', /registry unavailable/)
  assert.equal(unavailable.notices.join('').includes(SECRET), false)

  const missing = await run({ entries: [] })
  assert.match(missing.notices[0] ?? '', /No assistant text/)
  assert.equal(missing.customCalls, 0)

  const brokenBranch = await run({
    entries: [assistant(SECRET)],
    branchThrow: true,
  })
  assert.deepEqual(brokenBranch.copied, [])
  assert.match(brokenBranch.notices[0] ?? '', /branch is unavailable/)

  const failedCopy = await run({
    entries: [assistant('hello')],
    copyText: async () => {
      throw new Error('clipboard down')
    },
  })
  assert.match(failedCopy.notices[0] ?? '', /Clipboard copy failed/)
  assert.equal(failedCopy.notices.join('').includes('hello'), false)
  assert.equal(failedCopy.notices.join('').includes('clipboard down'), false)
})

test('production handler uses only public registry and root clipboard exports', async () => {
  const sdk = await import('@earendil-works/pi-coding-agent')
  assert.equal(typeof sdk.copyToClipboard, 'function')
  const notices: string[] = []
  const handler = createCopyCodeHandler({
    getCommands: () => [{ name: COPY_CODE_COMMAND, source: 'extension' }],
  } as never)
  await handler('', {
    mode: 'print',
    sessionManager: { getBranch: () => [assistant('```js\nx\n```')] },
    ui: { notify: (message: string) => notices.push(message) },
  } as never)
  assert.match(notices[0] ?? '', /1 response and 1 code block/)
})

test('registration uses mh-copy-code and does not replace the editor', () => {
  const commands = new Map<string, { description?: string }>()
  let editorReplacements = 0
  registerNativeUtilities({
    on() {
      return () => {}
    },
    registerFlag() {},
    getFlag() {
      return false
    },
    registerCommand(name: string, options: { description?: string }) {
      commands.set(name, options)
    },
    sendMessage() {},
    setEditorComponent() {
      editorReplacements += 1
    },
    getCommands() {
      return []
    },
  } as never)
  assert.equal(commands.has(COPY_CODE_COMMAND), true)
  assert.equal(commands.has('copy'), false)
  assert.match(commands.get(COPY_CODE_COMMAND)?.description ?? '', /current branch/)
  assert.equal(editorReplacements, 0)
})
