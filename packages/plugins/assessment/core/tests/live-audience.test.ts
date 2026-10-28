import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { Effect, Exit, Layer, Scope, Stream } from 'effect'
import { HttpRouter } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'kysely'
import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Api } from '@qualy/api-kit/local'
import { LIVE_SUBPROTOCOL } from '@qualy/api-kit/live-socket'
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
import { appointStaff } from './support/correction.ts'
import { ok, one, run, runningBatch, seed, stack } from './support/round.ts'

// Who hears what on a batch's live channel, served as the browser reaches
// it: a cookie, the page's origin, the socket.
//
// The results roster shows everybody's current total, and a total moves
// when a claim, a round or a result does. So whoever reads that roster -
// its administrators, and whoever re-determines over the people on it
// (ruling of 2026-09-25 #33) - hears those three kinds, the way a reviewer
// and a recorder already did. A participant still hears only their own.

const COOKIE = 'qualy_session'
const port = 3290

let db: Awaited<ReturnType<typeof createTestContext>>
let scope: Scope.Closeable | undefined
let batchId: string

/** the kinds this session hears, until a wake-up everybody hears comes through */
const heard = (token: string): Promise<readonly string[]> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/assessment/batches/${batchId}/events`,
      [LIVE_SUBPROTOCOL],
      { headers: { cookie: `${COOKIE}=${token}`, origin: `http://127.0.0.1:${port}` } },
    )
    const kinds: string[] = []
    const timer = setTimeout(() => {
      socket.terminate()
      resolve(kinds)
    }, 10_000)
    socket.on('message', (data) => {
      const kind = (JSON.parse(String(data)) as { kind: string }).kind
      kinds.push(kind)
      // the paper changing is heard by everybody who may watch the batch,
      // and it is announced last: once it is through, so is everything before
      if (kind === 'item-changed') {
        clearTimeout(timer)
        socket.close(1000)
        resolve(kinds)
      }
    })
    socket.on('unexpected-response', (_request, response) =>
      reject(new Error(`handshake refused: ${response.statusCode}`)),
    )
    socket.on('error', () => undefined)
  })

describe.runIf(postgresAvailable)('who hears what moves a total', () => {
  let tokens: { inspector: string; manager: string; neighbour: string }

  beforeAll(async () => {
    db = await createTestContext('assessment-live-audience')
    const seeded = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('live-audience')
          const g = yield* runningBatch(f)
          // re-determining over the first student's class, and nothing else
          const inspector = yield* appointStaff(f, g.batch.id, {
            name: 'Inspector',
            at: f.classA,
            codes: ['assessment.entry.redetermine'],
          })
          // administering the roster, and nothing else
          const manager = yield* appointStaff(f, g.batch.id, {
            name: 'Roster manager',
            at: f.root,
            codes: ['assessment.batch.manage'],
          })
          const door = one<{ id: string }>(
            yield* runSql(sql`
              insert into auth_providers (tenant_id, code, type, name, is_system)
              values (${f.t}, 'local', 'local', 'Local', true) returning id`),
          ).id
          const signIn = (userId: string, token: string) =>
            runSql(sql`
              insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
              values (${f.t}, ${userId}, ${door},
                      ${createHash('sha256').update(token).digest('hex')},
                      now() + interval '1 day')`)
          yield* signIn(inspector.who, 'live-audience-inspector')
          yield* signIn(manager.who, 'live-audience-manager')
          yield* signIn(f.s2, 'live-audience-neighbour')
          return { t: f.t, batchId: g.batch.id, s1: f.s1 }
        }),
      ),
    )
    batchId = seeded.batchId
    tokens = {
      inspector: 'live-audience-inspector',
      manager: 'live-audience-manager',
      neighbour: 'live-audience-neighbour',
    }
    // what the bus carries, the same for every connection: one student's
    // claim and result moved, a round moved, a queue moved, and the paper
    const announced: readonly AssessmentLiveEvent[] = [
      { tenantId: seeded.t, batchId, kind: 'entries-changed', subjectUserId: seeded.s1 },
      { tenantId: seeded.t, batchId, kind: 'result-changed', subjectUserId: seeded.s1 },
      { tenantId: seeded.t, batchId, kind: 'review-instance-changed', subjectUserId: null },
      { tenantId: seeded.t, batchId, kind: 'review-inbox-changed', subjectUserId: null },
      { tenantId: seeded.t, batchId, kind: 'item-changed', subjectUserId: null },
    ]
    const live = Layer.succeed(
      AssessmentLive,
      AssessmentLive.of({
        events: Stream.fromIterable(announced),
        subscribe: Effect.succeed(Stream.fromIterable(announced)),
        connections: connectionLedger(DEFAULT_CONNECTION_LIMITS),
      }),
    )
    const authConfig = Layer.succeed(
      AuthConfig,
      AuthConfig.of({
        defaultTenantSlug: 'live-audience',
        sessionTtlSeconds: 3600,
        secureCookies: false,
        sessionCookieName: COOKIE,
      }),
    )
    const services = stack(db.url)
    const sessions = Layer.mergeAll(sessionLayer, viewerLayer, presenceLayer).pipe(
      Layer.provide(Layer.mergeAll(services, authConfig)),
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

  afterAll(async () => {
    if (scope !== undefined) await Effect.runPromise(Scope.close(scope, Exit.void))
    await db?.dispose()
  })

  it('tells whoever only re-determines of the changes that move a total', async () => {
    expect(await heard(tokens.inspector)).toEqual([
      'sync',
      'entries-changed',
      'result-changed',
      'review-instance-changed',
      'item-changed',
    ])
  }, 30_000)

  it('tells whoever only administers the roster of the changes that move a total', async () => {
    expect(await heard(tokens.manager)).toEqual([
      'sync',
      'entries-changed',
      'result-changed',
      'review-instance-changed',
      'item-changed',
    ])
  }, 30_000)

  it('tells a participant nothing of somebody else’s claims', async () => {
    expect(await heard(tokens.neighbour)).toEqual(['sync', 'item-changed'])
  }, 30_000)
})
