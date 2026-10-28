import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { Effect, Exit, Layer, PubSub, Scope, Stream } from 'effect'
import { HttpRouter } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'kysely'
import WebSocket from 'ws'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Api } from '@qualy/api-kit/local'
import { LIVE_CLOSE, LIVE_PONG, LIVE_SUBPROTOCOL } from '@qualy/api-kit/live-socket'
import {
  layer as sessionLayer,
  presenceLayer,
  viewerLayer,
} from '@qualy/plugin-auth/server/session'
import { AuthConfig } from '@qualy/plugin-auth/server/sign-in'
import { assessmentApiGroup } from '../src/api.ts'
import { assessmentApiHandlers } from '../src/server/index.ts'
import { AssessmentLive } from '../src/live/service.ts'
import { connectionLedger, DEFAULT_CONNECTION_LIMITS } from '../src/live/connections.ts'
import type { AssessmentLiveEvent } from '../src/live/events.ts'
import { ok, one, run, runningBatch, seed, stack } from './support/round.ts'

// A batch's live channel, served as a browser reaches it: a real socket on a
// real port, the session cookie, the page's origin and the channel's
// subprotocol. Every refusal a page must act on arrives as a close code on a
// completed upgrade; the one that need not - another site's page - is a
// refused handshake.

const COOKIE = 'qualy_session'
const port = 3289
const base = `http://127.0.0.1:${port}`
const tokens = { admin: 'live-watch-admin', other: 'live-watch-other', gone: 'live-watch-gone' }

let db: Awaited<ReturnType<typeof createTestContext>>
let scope: Scope.Closeable | undefined
let batchId: string
let tenantId: string
let goneSession: string
const ledger = connectionLedger({ ...DEFAULT_CONNECTION_LIMITS, recheck: '150 millis' })
const bus = Effect.runSync(PubSub.unbounded<AssessmentLiveEvent>())

interface Line {
  readonly socket: WebSocket
  readonly kinds: string[]
  readonly closed: Promise<{ code: number; reason: string }>
}

const dial = (options: {
  token?: string | null
  origin?: string | null
  protocol?: string
  query?: string
}): Line => {
  const headers: Record<string, string> = {}
  if (options.token !== null) headers['cookie'] = `${COOKIE}=${options.token ?? tokens.admin}`
  if (options.origin !== null) headers['origin'] = options.origin ?? base
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/api/assessment/batches/${batchId}/events${options.query ?? ''}`,
    [options.protocol ?? LIVE_SUBPROTOCOL],
    { headers },
  )
  const kinds: string[] = []
  socket.on('message', (data) => {
    const kind = (JSON.parse(String(data)) as { kind: string }).kind
    kinds.push(kind)
    if (kind === 'heartbeat') socket.send(LIVE_PONG)
  })
  const closed = new Promise<{ code: number; reason: string }>((resolve, reject) => {
    socket.on('close', (code, reason) => resolve({ code, reason: String(reason) }))
    socket.on('unexpected-response', (_request, response) => {
      socket.terminate()
      reject(new Error(`handshake refused: ${response.statusCode}`))
    })
    socket.on('error', () => undefined)
  })
  return { socket, kinds, closed }
}

const until = async (predicate: () => boolean, ms = 5_000) => {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('the condition never held')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const open: Line[] = []
const held = (line: Line) => {
  open.push(line)
  return line
}

describe.runIf(postgresAvailable)('the batch live channel, as served', () => {
  beforeAll(async () => {
    db = await createTestContext('assessment-live-watch', { migrations: 'apply' })
    const services = stack(db.url)
    const seeded = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('live-watch')
          const g = yield* runningBatch(f)
          // somebody in another tenant, who cannot see this batch at all
          const other = yield* seed('live-watch-other')
          const door = (tenant: string) =>
            runSql(sql`
              insert into auth_providers (tenant_id, code, type, name, is_system)
              values (${tenant}, 'local', 'local', 'Local', true) returning id`)
          const here = one<{ id: string }>(yield* door(f.t)).id
          const there = one<{ id: string }>(yield* door(other.t)).id
          const signIn = (tenant: string, provider: string, user: string, token: string) =>
            runSql(sql`
              insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
              values (${tenant}, ${user}, ${provider},
                      ${createHash('sha256').update(token).digest('hex')},
                      now() + interval '1 day') returning id`)
          yield* signIn(f.t, here, f.admin, tokens.admin)
          yield* signIn(other.t, there, other.admin, tokens.other)
          const gone = one<{ id: string }>(yield* signIn(f.t, here, f.admin, tokens.gone)).id
          return { batchId: g.batch.id, tenantId: f.t, gone }
        }),
      ),
    )
    batchId = seeded.batchId
    tenantId = seeded.tenantId
    goneSession = seeded.gone

    const authConfig = Layer.succeed(
      AuthConfig,
      AuthConfig.of({
        defaultTenantSlug: 'live-watch',
        sessionTtlSeconds: 3600,
        secureCookies: false,
        sessionCookieName: COOKIE,
      }),
    )
    const sessions = Layer.mergeAll(sessionLayer, viewerLayer, presenceLayer).pipe(
      Layer.provide(Layer.mergeAll(services, authConfig)),
    )
    // the bus a test announces on, and a ledger whose recheck is quick
    const live = Layer.succeed(
      AssessmentLive,
      AssessmentLive.of({
        events: Stream.fromPubSub(bus),
        subscribe: Effect.map(PubSub.subscribe(bus), Stream.fromSubscription),
        connections: ledger,
      }),
    )
    const serving = HttpRouter.serve(
      HttpApiBuilder.layer(Api.local(assessmentApiGroup)).pipe(
        Layer.provide(assessmentApiHandlers.pipe(Layer.provide(services), Layer.provide(sessions))),
      ),
    ).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { port })),
      Layer.provide(services),
      Layer.provide(live),
      Layer.provide(sessions),
    )
    scope = await Effect.runPromise(Scope.make())
    await Effect.runPromise(Layer.buildWithScope(serving, scope))
  }, 120_000)

  afterEach(async () => {
    for (const line of open.splice(0)) line.socket.terminate()
    await until(() => ledger.open() === 0)
  })

  afterAll(async () => {
    if (scope !== undefined) await Effect.runPromise(Scope.close(scope, Exit.void))
    await db?.dispose()
  })

  const announce = (kind: AssessmentLiveEvent['kind'], target = batchId) =>
    Effect.runSync(PubSub.publish(bus, { tenantId, batchId: target, kind, subjectUserId: null }))

  it('says sync once the listener is judged, then what moves in the batch and nothing else', async () => {
    const line = held(dial({}))
    await until(() => line.kinds.includes('sync'))
    expect(line.socket.protocol).toBe(LIVE_SUBPROTOCOL)
    announce('item-changed', '00000000-0000-4000-8000-000000000000')
    announce('phase-changed')
    await until(() => line.kinds.includes('phase-changed'))
    expect(line.kinds).toEqual(['sync', 'phase-changed'])
    expect(ledger.open()).toBe(1)
  })

  it('refuses another site’s page before the handshake', async () => {
    await expect(dial({ origin: 'https://elsewhere.example' }).closed).rejects.toThrow(
      'handshake refused: 403',
    )
    await expect(dial({ origin: null }).closed).rejects.toThrow('handshake refused: 403')
    expect(ledger.open()).toBe(0)
  })

  it('tells a page still asking for an event stream to upgrade', async () => {
    const response = await fetch(`${base}/api/assessment/batches/${batchId}/events`, {
      headers: { cookie: `${COOKIE}=${tokens.admin}`, origin: base },
    })
    expect(response.status).toBe(426)
  })

  it('closes with 4401 for no session, and holds no seat for it', async () => {
    expect(await dial({ token: null }).closed).toEqual({
      code: LIVE_CLOSE.unauthenticated,
      reason: 'unauthenticated',
    })
    expect(await dial({ token: 'not-a-session' }).closed).toMatchObject({
      code: LIVE_CLOSE.unauthenticated,
    })
    expect(ledger.open()).toBe(0)
  })

  it('closes with 4403 for a batch the session may not watch', async () => {
    expect(await dial({ token: tokens.other }).closed).toEqual({
      code: LIVE_CLOSE.forbidden,
      reason: 'forbidden',
    })
    expect(ledger.open()).toBe(0)
  })

  it('closes with 4409 for a page this server cannot talk to, naming why', async () => {
    expect(await dial({ query: '?protocol=3&release=web-r1' }).closed).toEqual({
      code: LIVE_CLOSE.unsupported,
      reason: 'protocol',
    })
    expect(await dial({ query: '?protocol=4&release=..%2Fetc' }).closed).toEqual({
      code: LIVE_CLOSE.unsupported,
      reason: 'release',
    })
    // a page speaking another generation of the channel itself
    expect(await dial({ protocol: 'qualy.live.0' }).closed).toEqual({
      code: LIVE_CLOSE.unsupported,
      reason: 'protocol',
    })
    // a query said twice is not a query said once
    expect(await dial({ query: '?protocol=4&protocol=4' }).closed).toMatchObject({
      code: LIVE_CLOSE.unsupported,
    })
    expect(ledger.open()).toBe(0)
    const accepted = held(dial({ query: '?protocol=4&release=web-r1' }))
    await until(() => accepted.kinds.includes('sync'))
  })

  it('holds a session to six seats, tells the seventh to wait, and seats it once one is free', async () => {
    const six = Array.from({ length: DEFAULT_CONNECTION_LIMITS.perSession }, () => held(dial({})))
    await until(() => six.every((line) => line.kinds.includes('sync')))
    const seventh = dial({})
    expect(await seventh.closed).toEqual({ code: LIVE_CLOSE.quota, reason: 'session' })
    expect(seventh.kinds).toEqual([])
    expect(ledger.open()).toBe(DEFAULT_CONNECTION_LIMITS.perSession)

    six[0]!.socket.close(1000)
    await until(() => ledger.open() === DEFAULT_CONNECTION_LIMITS.perSession - 1)
    const next = held(dial({}))
    await until(() => next.kinds.includes('sync'))
    expect(ledger.open()).toBe(DEFAULT_CONNECTION_LIMITS.perSession)
  })

  it.each([
    [
      'anything but a pong',
      (socket: WebSocket) => socket.send('{"kind":"sync"}'),
      LIVE_CLOSE.policy,
    ],
    [
      'a binary frame',
      (socket: WebSocket) => socket.send(Buffer.from([1, 2])),
      LIVE_CLOSE.unsupportedData,
    ],
    [
      'a frame past the limit',
      (socket: WebSocket) => socket.send('p'.repeat(1_000)),
      LIVE_CLOSE.tooBig,
    ],
  ])('closes on %s, and gives the seat back', async (_, send, code) => {
    const line = dial({})
    await until(() => line.kinds.includes('sync'))
    send(line.socket)
    expect((await line.closed).code).toBe(code)
    await until(() => ledger.open() === 0)
  })

  it('lets a connection go within one recheck of its session ending', async () => {
    const line = dial({ token: tokens.gone })
    await until(() => line.kinds.includes('sync'))
    ok(await run(db.url, runSql(sql`delete from sessions where id = ${goneSession}`)))
    expect(await line.closed).toEqual({
      code: LIVE_CLOSE.unauthenticated,
      reason: 'session ended',
    })
    await until(() => ledger.open() === 0)
  })
})
