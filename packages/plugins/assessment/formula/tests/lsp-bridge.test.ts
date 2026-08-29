import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { inspect } from 'node:util'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import { NodeHttpServer, NodeSocket } from '@effect/platform-node'
import { sql } from 'kysely'
import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { Api } from '@qualy/api-kit/local'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { accessActions } from '@qualy/plugin-rbac/actions'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { ActivePermission } from '@qualy/rbac-contract'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { sessionCookieName, layer as sessionLayer } from '@qualy/plugin-auth/server/session'
import { FormulaAuthoringRpcs, SANDBOX_RPC_MAX_FRAME_BYTES } from '@qualy/sandbox-rpc'
import { AuthConfig } from '../../../base/auth/src/server/auth-config.ts'
import { hashSessionToken } from '../../../base/auth/src/session.ts'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import { permissions as formulaPermissions } from '../src/permissions.ts'
import { formulaActions } from '../src/actions.ts'
import { entities } from '../src/db/entities.ts'
import { formulaApiGroup } from '../src/api.ts'
import { formulaApiHandlers, layer as formulaLayer } from '../src/server/index.ts'
import { formulaLanguageLayer } from '../src/server/language.ts'
import { formulaLspQuotaLayer } from '../src/server/lsp-bridge.ts'

// The browser's whole language path, end to end and byte for byte: the
// ambient session cookie opens the handshake, the Origin header is the
// cross-site gate, and past the upgrade the wire speaks pure LSP json-rpc
// against a REAL authoring sandbox process. Every close code the bridge
// promises is provoked here, and both lifetimes - the person leaving and
// the sandbox dying - are watched all the way to a freed slot.

const port = 3206
const base = `http://127.0.0.1:${port}`

const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  { owner: 'assessment-formula', permissions: formulaPermissions },
])

const closure = [
  ...orgEntities,
  ...authEntities,
  ...rbacEntities,
  ...auditEntities,
  ...entities,
] as const

const here = createRequire(import.meta.url)
const authoringMain = () =>
  path.join(
    path.dirname(here.resolve('@qualy/sandbox-authoring/package.json')),
    'src',
    'main.ts',
  )

// with QUALY_SANDBOX_PARITY_EXTERNAL=1 the suite speaks to whatever serves
// the default .qualy authoring socket - the container-form acceptance run -
// instead of spawning its own process; the process-killing case skips, the
// rest of the protocol must hold identically
const external = process.env.QUALY_SANDBOX_PARITY_EXTERNAL === '1'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-lsp-bridge-'))
const authoringSocket = external
  ? path.resolve('.qualy/run/sandbox/authoring/authoring.sock')
  : path.join(tempDir, 'authoring.sock')

const waitForSocket = async (file: string, child: ChildProcess): Promise<void> => {
  const deadline = Date.now() + 30_000
  for (;;) {
    if (fs.existsSync(file)) return
    if (child.exitCode !== null)
      throw new Error(`the authoring process exited early with ${child.exitCode}`)
    if (Date.now() > deadline) throw new Error('the authoring socket never appeared')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const spawnAuthoring = async (): Promise<ChildProcess> => {
  const child = spawn(process.execPath, [authoringMain()], {
    env: { ...process.env, QUALY_SANDBOX_AUTHORING_SOCKET: authoringSocket },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  await waitForSocket(authoringSocket, child)
  return child
}

const IDENTITY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2 }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>
let authoring: ChildProcess | undefined
let functionId: string
const token = 'formula-lsp-token'

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

const seed = Effect.fn('seed')(function* () {
  const t = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('fx-lsp','T') returning id`),
  ).id
  const orgType = one<{ id: string }>(
    yield* runSql(sql`insert into org_types (tenant_id, name) values (${t}, 'U') returning id`),
  ).id
  const root = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${t}, ${orgType}, 'Root', 'fx_lsp', 0) returning id`),
  ).id
  const userType = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${t},'staff','Staff','unrestricted') returning id`),
  ).id
  const admin = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${t}, 'Admin', ${userType}, ${root}) returning id`),
  ).id
  const role = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
      values (${t}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
      returning id`),
  ).id
  yield* runSql(
    sql`insert into role_grants (tenant_id, user_id, role_id) values (${t}, ${admin}, ${role})`,
  )
  yield* runSql(sql`
    insert into sessions (tenant_id, user_id, token_hash, expires_at)
    values (${t}, ${admin}, ${hashSessionToken(token)}, now() + interval '1 day')`)
  return { root }
})

const call = async (method: string, path_: string, body?: unknown) => {
  const response = await fetch(`${base}${path_}`, {
    method,
    headers: {
      cookie: `${sessionCookieName}=${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // some refusals are plain text; the assertions see whatever came back
  }
  return { status: response.status, body: parsed }
}

const authoringCapabilities = () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(FormulaAuthoringRpcs)
        return yield* client.GetAuthoringCapabilities()
      }),
    ).pipe(
      Effect.provide(
        RpcClient.layerProtocolSocket().pipe(
          Layer.provide(NodeSocket.layerNet({ path: authoringSocket }).pipe(Layer.orDie)),
          Layer.provide(
            RpcSerialization.layerNdjsonWith({ maxBufferSize: SANDBOX_RPC_MAX_FRAME_BYTES }),
          ),
        ),
      ),
    ),
  )

interface JsonRpcMessage {
  readonly id?: number
  readonly method?: string
  readonly result?: unknown
  readonly params?: unknown
}

/** one connected browser: a frame log, a matcher, and the close outcome */
class Client {
  readonly frames: JsonRpcMessage[] = []
  readonly closed: Promise<{ code: number; reason: string }>
  private readonly waiters: {
    predicate: (message: JsonRpcMessage) => boolean
    resolve: (message: JsonRpcMessage) => void
  }[] = []

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as JsonRpcMessage
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message))
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1)
        waiter!.resolve(message)
        return
      }
      this.frames.push(message)
    })
    this.closed = new Promise((resolve) => {
      socket.on('close', (code, reason) => resolve({ code, reason: String(reason) }))
    })
  }

  send(message: object): void {
    this.socket.send(JSON.stringify(message))
  }

  wait(predicate: (message: JsonRpcMessage) => boolean, label: string): Promise<JsonRpcMessage> {
    const backlog = this.frames.findIndex(predicate)
    if (backlog >= 0) return Promise.resolve(this.frames.splice(backlog, 1)[0]!)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${label}`)),
        30_000,
      )
      this.waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer)
          resolve(message)
        },
      })
    })
  }
}

const handshake = (options?: {
  readonly origin?: string | null
  readonly cookie?: string | null
  readonly target?: string
}): Promise<Client> =>
  new Promise((resolve, reject) => {
    const headers: Record<string, string> = {}
    if (options?.cookie !== null)
      headers['cookie'] = `${sessionCookieName}=${options?.cookie ?? token}`
    if (options?.origin !== null) headers['origin'] = options?.origin ?? base
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/assessment/formula-functions/${options?.target ?? functionId}/lsp`,
      { headers },
    )
    socket.on('unexpected-response', (_request, response) => {
      socket.terminate()
      reject(new Error(`handshake refused: ${response.statusCode}`))
    })
    socket.on('error', (error) => reject(error))
    socket.on('open', () => resolve(new Client(socket)))
  })

const refusalOf = async (promise: Promise<Client>): Promise<number> => {
  try {
    await promise
    throw new Error('the handshake unexpectedly succeeded')
  } catch (error) {
    const match = /handshake refused: (\d+)/.exec(String(error))
    if (!match) throw error
    return Number(match[1])
  }
}

/** initialize + didOpen: the preamble every real editor session sends */
const openDocument = async (client: Client): Promise<void> => {
  client.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { processId: null, rootUri: null, capabilities: {} },
  })
  await client.wait((message) => message.id === 1, 'initialize result')
  client.send({ jsonrpc: '2.0', method: 'initialized', params: {} })
  client.send({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri: 'qualy-formula:///formula.ts',
        languageId: 'typescript',
        version: 1,
        text: IDENTITY,
      },
    },
  })
  await client.wait(
    (message) => message.method === 'textDocument/publishDiagnostics',
    'the policy voice after didOpen',
  )
}

beforeAll(async () => {
  if (!postgresAvailable) return
  if (!external) authoring = await spawnAuthoring()
  db = await createTestContext('formula-lsp')

  const infra = databaseFor(db.url, { entities: closure })
  const services = booted(
    rbacLayer.pipe(
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([
                { owner: 'rbac', actions: accessActions },
                { owner: 'assessment-formula', actions: formulaActions },
              ]),
            ),
          ),
        ),
      ),
      Layer.provideMerge(Layer.mergeAll(uiLayer, infra)),
    ),
    { catalog },
  )
  const authConfig = Layer.succeed(
    AuthConfig,
    AuthConfig.of({ defaultTenantSlug: 'fx-lsp', sessionTtlSeconds: 3600, secureCookies: false }),
  )
  const library = Layer.mergeAll(
    formulaLayer.pipe(
      Layer.provide(sandboxLocalLayer({ size: 1, variant: 'release' })),
      Layer.provide(formulaAuthoringLocalLayer),
    ),
    formulaLanguageLayer({ socketPath: authoringSocket }),
    formulaLspQuotaLayer,
  ).pipe(Layer.provideMerge(services))
  const application = HttpRouter.serve(
    HttpApiBuilder.layer(Api.local(formulaApiGroup)).pipe(
      Layer.provide(
        formulaApiHandlers.pipe(
          Layer.provide(library),
          Layer.provide(sessionLayer.pipe(Layer.provide(Layer.mergeAll(infra, authConfig)))),
        ),
      ),
    ),
  ).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provide(infra),
    Layer.provide(library),
  )

  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
  const seeded = Exit.match(await Effect.runPromiseExit(Effect.provide(seed(), infra)), {
    onFailure: (cause) => {
      throw new Error(inspect(cause, { depth: 8 }))
    },
    onSuccess: (value) => value,
  })

  const created = await call('POST', '/api/assessment/formula-functions', {
    ownerNodeId: seeded.root,
    name: 'Language target',
  })
  if (created.status !== 200) throw new Error(inspect(created.body))
  functionId = (created.body as { function: { id: string } }).function.id
  const saved = await call('PATCH', `/api/assessment/formula-functions/${functionId}`, {
    expectedDraftRevision: 1,
    name: 'Language target',
    draftSourceTs: IDENTITY,
    draftTests: [],
  })
  if (saved.status !== 200) throw new Error(inspect(saved.body))
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope as Scope.Closeable, Exit.void))
  authoring?.kill('SIGKILL')
  await db.dispose()
})

describe.runIf(postgresAvailable).sequential('the formula language bridge', () => {
  it('refuses the handshake without a same-origin page behind it', async () => {
    expect(await refusalOf(handshake({ origin: null }))).toBe(403)
    expect(await refusalOf(handshake({ origin: 'https://evil.example' }))).toBe(403)
    expect(await refusalOf(handshake({ origin: `chrome-extension://abcdef` }))).toBe(403)
  }, 30_000)

  it('refuses the handshake without a live session', async () => {
    expect(await refusalOf(handshake({ cookie: null }))).toBe(401)
    expect(await refusalOf(handshake({ cookie: 'not-a-real-token' }))).toBe(401)
  }, 30_000)

  it('reads an unknown function as the same not-found a stranger sees', async () => {
    expect(
      await refusalOf(handshake({ target: '00000000-0000-7000-8000-000000000000' })),
    ).toBe(404)
  }, 30_000)

  it('speaks the language: completion, hover and both diagnostic voices', async () => {
    const client = await handshake()
    try {
      await openDocument(client)

      client.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/completion',
        params: {
          textDocument: { uri: 'qualy-formula:///formula.ts' },
          position: { line: 3, character: 17 },
        },
      })
      const completion = await client.wait((message) => message.id === 2, 'completion')
      const items = (completion.result as { items?: readonly { label: string }[] })?.items
      expect(items, inspect(completion)).toBeDefined()
      expect(items!.map((item) => item.label)).toContain('decimal')

      client.send({
        jsonrpc: '2.0',
        id: 3,
        method: 'textDocument/hover',
        params: {
          textDocument: { uri: 'qualy-formula:///formula.ts' },
          position: { line: 2, character: 20 },
        },
      })
      const hover = await client.wait((message) => message.id === 3, 'hover')
      expect(JSON.stringify((hover.result as { contents: unknown }).contents)).toContain(
        'defineFormula',
      )

      client.send({
        jsonrpc: '2.0',
        id: 4,
        method: 'textDocument/diagnostic',
        params: { textDocument: { uri: 'qualy-formula:///formula.ts' } },
      })
      const clean = await client.wait((message) => message.id === 4, 'clean diagnostics')
      expect((clean.result as { items: readonly unknown[] }).items).toEqual([])

      // the compiler's voice: a type error the pull round-trip must surface
      client.send({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'qualy-formula:///formula.ts', version: 2 },
          contentChanges: [{ text: `${IDENTITY}\nconst broken: number = 'text'\n` }],
        },
      })
      await client.wait(
        (message) => message.method === 'textDocument/publishDiagnostics',
        'the policy voice after didChange',
      )
      client.send({
        jsonrpc: '2.0',
        id: 5,
        method: 'textDocument/diagnostic',
        params: { textDocument: { uri: 'qualy-formula:///formula.ts' } },
      })
      const broken = await client.wait((message) => message.id === 5, 'type diagnostics')
      expect((broken.result as { items: readonly unknown[] }).items.length).toBeGreaterThan(0)

      // the policy's voice: a refused import arrives as pushed diagnostics
      client.send({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'qualy-formula:///formula.ts', version: 3 },
          contentChanges: [{ text: `import fs from 'node:fs'\n${IDENTITY}` }],
        },
      })
      const policy = await client.wait(
        (message) =>
          message.method === 'textDocument/publishDiagnostics' &&
          ((message.params as { diagnostics: readonly unknown[] }).diagnostics.length ?? 0) > 0,
        'the policy voice refusing an import',
      )
      expect(
        JSON.stringify((policy.params as { diagnostics: unknown }).diagnostics),
      ).toContain('import')
    } finally {
      client.socket.close(1000)
      await client.closed
    }
  }, 120_000)

  it('answers a numbered burst without refusing any of them', async () => {
    const client = await handshake()
    try {
      await openDocument(client)
      const ids = Array.from({ length: 20 }, (_, index) => 100 + index)
      for (const id of ids) {
        client.send({
          jsonrpc: '2.0',
          id,
          method: 'textDocument/completion',
          params: {
            textDocument: { uri: 'qualy-formula:///formula.ts' },
            position: { line: 3, character: 17 },
          },
        })
      }
      for (const id of ids) {
        const answer = await client.wait((message) => message.id === id, `burst answer ${id}`)
        expect(answer.result, inspect(answer)).toBeDefined()
      }
    } finally {
      client.socket.close(1000)
      await client.closed
    }
  }, 120_000)

  it('holds one seat per person and refuses the second browser', async () => {
    const client = await handshake()
    try {
      expect(await refusalOf(handshake())).toBe(429)
    } finally {
      client.socket.close(1000)
      await client.closed
    }
    // the seat comes back once the first connection is gone
    await expect
      .poll(async () => (await authoringCapabilities()).activeLspSessions, { timeout: 10_000 })
      .toBe(0)
  }, 60_000)

  it('turns a binary frame into 1003', async () => {
    const client = await handshake()
    client.socket.send(Buffer.from([1, 2, 3]))
    const closed = await client.closed
    expect(closed.code).toBe(1003)
  }, 30_000)

  it('turns an oversized frame into 1009', async () => {
    const client = await handshake()
    client.socket.send(`x`.repeat(1024 * 1024 + 1))
    const closed = await client.closed
    expect(closed.code).toBe(1009)
  }, 30_000)

  it('turns a malformed frame into 1008', async () => {
    const client = await handshake()
    client.socket.send('null')
    const closed = await client.closed
    expect(closed.code).toBe(1008)
    expect(closed.reason).toBe('malformed')
  }, 30_000)

  it('frees the session promptly when the browser vanishes mid-conversation', async () => {
    const client = await handshake()
    await openDocument(client)
    expect((await authoringCapabilities()).activeLspSessions).toBe(1)
    // no close frame, no goodbye - the tab was killed
    client.socket.terminate()
    await expect
      .poll(async () => (await authoringCapabilities()).activeLspSessions, { timeout: 10_000 })
      .toBe(0)
    // and the seat is free again
    const next = await handshake()
    next.socket.close(1000)
    await next.closed
  }, 60_000)

  it.skipIf(external)('reports the authoring sandbox dying as 1011 and frees the seat', async () => {
    const client = await handshake()
    await openDocument(client)
    authoring!.kill('SIGKILL')
    const closed = await client.closed
    expect(closed.code).toBe(1011)
    // the seat was returned even though the language side died: the next
    // refusal is about availability, not the quota
    expect(await refusalOf(handshake())).toBe(503)
    // a restarted sandbox brings the whole path back on the same address
    authoring = await spawnAuthoring()
    const deadline = Date.now() + 20_000
    for (;;) {
      try {
        const revived = await handshake()
        revived.socket.close(1000)
        await revived.closed
        break
      } catch (error) {
        if (Date.now() > deadline) throw error
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  }, 60_000)

  it('ends every open conversation when the backend shuts down', async () => {
    const client = await handshake()
    await openDocument(client)
    // the interrupts of the server's own fibers surface in the close exit;
    // what this test owns is the socket's fate, asserted below
    await Effect.runPromiseExit(Scope.close(scope as Scope.Closeable, Exit.void))
    const closed = await Promise.race([
      client.closed,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('the shutdown never reached the socket')), 10_000),
      ),
    ])
    // the exact code is the platform's business; the connection ending is ours
    expect(closed.code).toBeGreaterThanOrEqual(1000)
  }, 30_000)
})
