import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Exit, Layer, Scope, Stream } from 'effect'
import { NodeSocket } from '@effect/platform-node'
import { RpcClient, RpcClientError, RpcGroup, RpcSerialization } from 'effect/unstable/rpc'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FormulaAuthoringRpcs, SANDBOX_RPC_MAX_FRAME_BYTES } from '@qualy/sandbox-rpc'

// F1: the language server behind the authoring socket, driven exactly the
// way the future bridge will drive it - a REAL TS7 process per session, a
// copied workspace, virtual URIs, the method allowlist, and a lifecycle
// that always ends in a dead process and a removed workspace. With
// QUALY_SANDBOX_PARITY_EXTERNAL=1 the suite skips spawning and drives
// whatever serves the default socket (the hardened container), where the
// host-observability assertions (process counts, tmp directories) are
// skipped and the SEMANTIC assertions must hold identically.

const external = process.env.QUALY_SANDBOX_PARITY_EXTERNAL === '1'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-lsp-suite-'))
const socketPath = external
  ? path.resolve('.qualy/run/sandbox/authoring/authoring.sock')
  : path.join(tempDir, 'authoring.sock')

const mainOf = (): string =>
  path.join(path.dirname(new URL('.', import.meta.url).pathname), 'src', 'main.ts')

const lspProcessCount = (): number => {
  const out = execFileSync('ps', ['-ax', '-o', 'command'], { encoding: 'utf8' })
  // bin/tsc is a js launcher that execs the NATIVE binary; the real process
  // path goes through the platform package (measured)
  return out
    .split('\n')
    .filter((line) => line.includes('@typescript+typescript-') && line.includes('--lsp')).length
}

const lspWorkspaceCount = (): number =>
  fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('qualy-lsp-')).length

let child: ChildProcess | undefined
let scope: Scope.Scope
let client: RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof FormulaAuthoringRpcs>,
  RpcClientError.RpcClientError
>

const FIXTURE = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2 }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input, q) => {
    const doubled = q.decimal.mulInteger(input.value, 2)
    return input.value
  },
})

const bad: number = 'oops'
`

beforeAll(async () => {
  if (!external) {
    child = spawn(process.execPath, [mainOf()], {
      env: {
        ...process.env,
        QUALY_SANDBOX_AUTHORING_SOCKET: socketPath,
        // roomy on purpose: a first completion builds the whole program and
        // can outlast a tight idle window; the reaper case spawns its own
        // short-idle instance instead
        QUALY_LSP_IDLE_MS: '60000',
        QUALY_LSP_ABSOLUTE_MS: '600000',
        QUALY_LSP_SWEEP_MS: '500',
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    const deadline = Date.now() + 30_000
    while (!fs.existsSync(socketPath)) {
      if (child.exitCode !== null) throw new Error(`authoring exited ${child.exitCode}`)
      if (Date.now() > deadline) throw new Error('authoring socket never appeared')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  scope = await Effect.runPromise(Scope.make())
  const layer = Layer.mergeAll(RpcClient.layerProtocolSocket()).pipe(
    Layer.provide(NodeSocket.layerNet({ path: socketPath })),
    Layer.provide(RpcSerialization.layerNdjsonWith({ maxBufferSize: SANDBOX_RPC_MAX_FRAME_BYTES })),
  )
  const context = await Effect.runPromise(Layer.buildWithScope(layer, scope))
  client = await Effect.runPromise(
    Effect.provide(RpcClient.make(FormulaAuthoringRpcs), context).pipe(
      Scope.provide(scope as Scope.Closeable),
    ),
  )
}, 60_000)

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope as Scope.Closeable, Exit.void))
  if (child !== undefined) {
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child?.kill('SIGKILL')
        resolve(undefined)
      }, 3_000)
      child?.once('exit', () => {
        clearTimeout(timer)
        resolve(undefined)
      })
    })
  }
  fs.rmSync(tempDir, { recursive: true, force: true })
})

/** one driven session: sequence bookkeeping, an event collector, waiters */
const openSession = async (initialSource: string) => {
  const opened = await Effect.runPromise(client.OpenLsp({ initialSource }))
  const events: { sequence: number; jsonRpc: string }[] = []
  const eventScope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(
    client.LspEvents({ sessionId: opened.sessionId }).pipe(
      Stream.runForEach((event) => Effect.sync(() => void events.push(event))),
      Effect.forkIn(eventScope),
    ),
  )
  let sequence = 0
  let requestId = 0
  const send = (message: Record<string, unknown>) => {
    sequence += 1
    return Effect.runPromise(
      client.SendLsp({
        sessionId: opened.sessionId,
        sequence,
        jsonRpc: JSON.stringify({ jsonrpc: '2.0', ...message }),
      }),
    )
  }
  const request = async (method: string, params: unknown): Promise<unknown> => {
    requestId += 1
    const id = requestId
    await send({ id, method, params })
    return awaitEvent((message) => (message as { id?: number }).id === id).then(
      (message) => (message as { result?: unknown }).result,
    )
  }
  const awaitEvent = (
    matches: (message: unknown) => boolean,
    timeoutMs = 30_000,
  ): Promise<unknown> => {
    const deadline = Date.now() + timeoutMs
    let cursor = 0
    return new Promise((resolve, reject) => {
      const look = () => {
        for (; cursor < events.length; cursor += 1) {
          const parsed = JSON.parse(events[cursor]!.jsonRpc) as unknown
          if (matches(parsed)) return resolve(parsed)
        }
        if (Date.now() > deadline) return reject(new Error('no matching lsp event'))
        setTimeout(look, 25)
      }
      look()
    })
  }
  return {
    sessionId: opened.sessionId,
    events,
    send,
    request,
    awaitEvent,
    raw: (sequenceOverride: number, jsonRpc: string) =>
      Effect.runPromiseExit(
        client.SendLsp({ sessionId: opened.sessionId, sequence: sequenceOverride, jsonRpc }),
      ),
    nextSequence: () => (sequence += 1),
    stopEvents: () => Effect.runPromise(Scope.close(eventScope as Scope.Closeable, Exit.void)),
    close: () => Effect.runPromise(client.CloseLsp({ sessionId: opened.sessionId })),
  }
}

const initialize = async (session: Awaited<ReturnType<typeof openSession>>, text: string) => {
  const result = (await session.request('initialize', {
    processId: null,
    rootUri: null,
    capabilities: {},
  })) as { capabilities?: unknown }
  expect(result.capabilities).toBeTypeOf('object')
  await session.send({ method: 'initialized', params: {} })
  await session.send({
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri: 'qualy-formula:///formula.ts',
        languageId: 'typescript',
        version: 1,
        text,
      },
    },
  })
}

const activeSessions = (): Promise<number> =>
  Effect.runPromise(client.GetAuthoringCapabilities()).then((caps) => caps.activeLspSessions)

describe.sequential('the formula language service', () => {
  it('answers completion, hover, signatures, symbols and both diagnostic voices', async () => {
    const session = await openSession(FIXTURE)
    try {
      await initialize(session, FIXTURE)

      // Qualy's own voice arrives on didOpen, empty for a clean source
      const policy = (await session.awaitEvent(
        (message) => (message as { method?: string }).method === 'textDocument/publishDiagnostics',
      )) as { params: { uri: string; diagnostics: unknown[] } }
      expect(policy.params.uri).toBe('qualy-formula:///formula.ts')
      expect(policy.params.diagnostics).toEqual([])

      const lines = FIXTURE.split('\n')
      const returnLine = lines.findIndex((line) => line.includes('return input.value'))
      const completion = (await session.request('textDocument/completion', {
        textDocument: { uri: 'qualy-formula:///formula.ts' },
        position: { line: returnLine, character: lines[returnLine]!.indexOf('input.') + 6 },
      })) as { items?: { label: string }[] } | { label: string }[]
      const labels = (Array.isArray(completion) ? completion : (completion.items ?? [])).map(
        (item) => item.label,
      )
      expect(labels).toContain('value')

      const hover = (await session.request('textDocument/hover', {
        textDocument: { uri: 'qualy-formula:///formula.ts' },
        position: { line: 2, character: lines[2]!.indexOf('defineFormula') + 3 },
      })) as { contents?: { value?: string } }
      expect(JSON.stringify(hover.contents)).toContain('FormulaDefinition')

      const signatureLine = lines.findIndex((line) => line.includes('mulInteger('))
      const signatures = (await session.request('textDocument/signatureHelp', {
        textDocument: { uri: 'qualy-formula:///formula.ts' },
        position: {
          line: signatureLine,
          character: lines[signatureLine]!.indexOf('mulInteger(') + 'mulInteger('.length,
        },
      })) as { signatures?: { label: string }[] }
      expect(signatures.signatures?.[0]?.label).toContain('mulInteger(a: Decimal, by: number)')

      const symbols = (await session.request('textDocument/documentSymbol', {
        textDocument: { uri: 'qualy-formula:///formula.ts' },
      })) as unknown[]
      expect(Array.isArray(symbols)).toBe(true)

      // the definition of Schema lands inside the VIRTUAL sdk tree
      const definitions = (await session.request('textDocument/definition', {
        textDocument: { uri: 'qualy-formula:///formula.ts' },
        position: { line: 0, character: lines[0]!.indexOf('Schema') + 2 },
      })) as { uri: string }[]
      expect(definitions[0]?.uri).toMatch(/^qualy-formula-sdk:\/\/\//)
      expect(JSON.stringify(definitions)).not.toContain('file://')

      // TS7 diagnostics come from the PULL channel (measured: it declares a
      // diagnosticProvider and pushes nothing itself)
      const diagnostics = (await session.request('textDocument/diagnostic', {
        textDocument: { uri: 'qualy-formula:///formula.ts' },
      })) as { kind: string; items: { code?: unknown; message: string }[] }
      expect(diagnostics.kind).toBe('full')
      expect(diagnostics.items.map((item) => item.code)).toContain(2322)

      // Qualy's voice again, now with something to say
      const smuggling = `import fs from 'node:fs'\nlet a: any\n${FIXTURE}`
      await session.send({
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'qualy-formula:///formula.ts', version: 2 },
          contentChanges: [{ text: smuggling }],
        },
      })
      const refusals = (await session.awaitEvent((message) => {
        const typed = message as {
          method?: string
          params?: { diagnostics?: { source?: string }[] }
        }
        return (
          typed.method === 'textDocument/publishDiagnostics' &&
          (typed.params?.diagnostics?.length ?? 0) > 0
        )
      })) as { params: { diagnostics: { code: string; source: string; message: string }[] } }
      const codes = refusals.params.diagnostics.map((diagnostic) => diagnostic.code)
      expect(codes).toContain('formula/import')
      expect(codes).toContain('formula/any')
      for (const diagnostic of refusals.params.diagnostics)
        expect(diagnostic.source).toBe('qualy-formula')
    } finally {
      await session.close()
    }
    expect(await activeSessions()).toBe(0)
  }, 120_000)

  it('cleans up on explicit close, and the session name dies with it', async () => {
    const before = external ? 0 : lspProcessCount()
    const session = await openSession(FIXTURE)
    await initialize(session, FIXTURE)
    await session.close()
    expect(await activeSessions()).toBe(0)
    const sent = await session.raw(999, JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }))
    expect(Exit.isFailure(sent)).toBe(true)
    if (!external) {
      const deadline = Date.now() + 10_000
      while (lspProcessCount() > before && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100))
      expect(lspProcessCount()).toBe(before)
    }
  }, 60_000)

  it('reaps an idle session and removes its workspace', async () => {
    if (external) return // idle windows are production-sized in the container
    // a dedicated short-idle instance, so the tight window cannot shoot the
    // slower cases of the main suite in the back
    const ownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-lsp-idle-'))
    const ownSocket = path.join(ownDir, 'authoring.sock')
    const own = spawn(process.execPath, [mainOf()], {
      env: {
        ...process.env,
        QUALY_SANDBOX_AUTHORING_SOCKET: ownSocket,
        QUALY_LSP_IDLE_MS: '1500',
        QUALY_LSP_SWEEP_MS: '300',
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    const ownScope = await Effect.runPromise(Scope.make())
    try {
      const deadline = Date.now() + 30_000
      while (!fs.existsSync(ownSocket)) {
        if (Date.now() > deadline) throw new Error('short-idle authoring never listened')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const layer = RpcClient.layerProtocolSocket().pipe(
        Layer.provide(NodeSocket.layerNet({ path: ownSocket })),
        Layer.provide(
          RpcSerialization.layerNdjsonWith({ maxBufferSize: SANDBOX_RPC_MAX_FRAME_BYTES }),
        ),
      )
      const context = await Effect.runPromise(Layer.buildWithScope(layer, ownScope))
      const ownClient = await Effect.runPromise(
        Effect.provide(RpcClient.make(FormulaAuthoringRpcs), context).pipe(
          Scope.provide(ownScope as Scope.Closeable),
        ),
      )
      const workspacesBefore = lspWorkspaceCount()
      const opened = await Effect.runPromise(ownClient.OpenLsp({ initialSource: FIXTURE }))
      expect(lspWorkspaceCount()).toBe(workspacesBefore + 1)
      const reaped = Date.now() + 15_000
      const sessionsOf = () =>
        Effect.runPromise(ownClient.GetAuthoringCapabilities()).then(
          (caps) => caps.activeLspSessions,
        )
      while ((await sessionsOf()) > 0 && Date.now() < reaped)
        await new Promise((resolve) => setTimeout(resolve, 250))
      expect(await sessionsOf()).toBe(0)
      expect(lspWorkspaceCount()).toBe(workspacesBefore)
      void opened
    } finally {
      await Effect.runPromise(Scope.close(ownScope as Scope.Closeable, Exit.void))
      own.kill('SIGKILL')
      fs.rmSync(ownDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('takes a departing events subscriber as the client leaving', async () => {
    const session = await openSession(FIXTURE)
    await initialize(session, FIXTURE)
    await session.stopEvents()
    const deadline = Date.now() + 10_000
    while ((await activeSessions()) > 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await activeSessions()).toBe(0)
  }, 60_000)
})

describe.sequential('the hostile author', () => {
  it('refuses foreign and traversing uris by name', async () => {
    const session = await openSession(FIXTURE)
    try {
      await initialize(session, FIXTURE)
      for (const uri of [
        'file:///etc/passwd',
        'file:///proc/self/environ',
        'qualy-formula-sdk:///../../../etc/passwd',
      ]) {
        const outcome = await session.raw(
          session.nextSequence(),
          JSON.stringify({
            jsonrpc: '2.0',
            id: 900,
            method: 'textDocument/hover',
            params: { textDocument: { uri }, position: { line: 0, character: 0 } },
          }),
        )
        expect(Exit.isFailure(outcome), uri).toBe(true)
        if (Exit.isFailure(outcome)) expect(String(outcome.cause), uri).toContain('LspUriRefused')
      }
    } finally {
      await session.close()
    }
  }, 60_000)

  it('refuses methods outside the allowlist', async () => {
    const session = await openSession(FIXTURE)
    try {
      for (const method of [
        'workspace/executeCommand',
        'workspace/applyEdit',
        'workspace/didChangeWorkspaceFolders',
      ]) {
        const outcome = await session.raw(
          session.nextSequence(),
          JSON.stringify({ jsonrpc: '2.0', id: 901, method, params: {} }),
        )
        expect(Exit.isFailure(outcome), method).toBe(true)
        if (Exit.isFailure(outcome))
          expect(String(outcome.cause), method).toContain('LspMethodRefused')
      }
    } finally {
      await session.close()
    }
  }, 60_000)

  it('refuses oversized frames, replayed and reordered sequences, forged sessions', async () => {
    const session = await openSession(FIXTURE)
    try {
      const huge = await session.raw(
        session.nextSequence(),
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialized',
          params: { pad: 'x'.repeat(1024 * 1024) },
        }),
      )
      expect(Exit.isFailure(huge)).toBe(true)
      if (Exit.isFailure(huge)) expect(String(huge.cause)).toContain('LspFrameTooLarge')

      await session.send({ method: 'initialized', params: {} })
      const replay = await session.raw(1, JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }))
      expect(Exit.isFailure(replay)).toBe(true)
      if (Exit.isFailure(replay)) expect(String(replay.cause)).toContain('LspSequenceRejected')

      const forgedSend = await Effect.runPromiseExit(
        client.SendLsp({
          sessionId: 'forged-session-id',
          sequence: 1,
          jsonRpc: JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }),
        }),
      )
      expect(Exit.isFailure(forgedSend)).toBe(true)
      if (Exit.isFailure(forgedSend))
        expect(String(forgedSend.cause)).toContain('LspSessionNotFound')

      const forgedEvents = await Effect.runPromiseExit(
        client.LspEvents({ sessionId: 'forged-session-id' }).pipe(Stream.runDrain, Effect.scoped),
      )
      expect(Exit.isFailure(forgedEvents)).toBe(true)
    } finally {
      await session.close()
    }
  }, 60_000)

  it('survives its language server dying underneath it', async () => {
    if (external) return // the container hides pids from the host
    const pidsOf = (): Set<number> =>
      new Set(
        execFileSync('ps', ['-ax', '-o', 'pid,command'], { encoding: 'utf8' })
          .split('\n')
          .filter((line) => line.includes('@typescript+typescript-') && line.includes('--lsp'))
          .map((line) => Number(line.trim().split(/\s+/)[0])),
      )
    const before = pidsOf()
    const session = await openSession(FIXTURE)
    await initialize(session, FIXTURE)
    // the set DIFFERENCE, not the newest row: parallel suites (lsp-smoke)
    // spawn their own servers and ps orders nothing
    const born = [...pidsOf()].filter((pid) => !before.has(pid))
    expect(born.length).toBeGreaterThan(0)
    process.kill(born[0]!, 'SIGKILL')
    const deadline = Date.now() + 10_000
    while ((await activeSessions()) > 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await activeSessions()).toBe(0)
    await session.stopEvents()
  }, 60_000)

  it('holds the global session ceiling', async () => {
    const sessions = []
    try {
      for (let i = 0; i < 8; i += 1) sessions.push(await openSession('export default 1'))
      const overflow = await Effect.runPromiseExit(
        client.OpenLsp({ initialSource: 'export default 1' }),
      )
      expect(Exit.isFailure(overflow)).toBe(true)
      if (Exit.isFailure(overflow)) expect(String(overflow.cause)).toContain('LspBusy')
    } finally {
      for (const session of sessions) await session.close()
    }
    expect(await activeSessions()).toBe(0)
  }, 120_000)
})
