import { createHash } from 'node:crypto'
import { Effect, Layer, Stream } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Api } from '@qualy/api-kit/local'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { layer as sessionLayer } from '@qualy/plugin-auth/server/session'
import { AuthConfig } from '@qualy/plugin-auth/server/sign-in'
import { assessmentApiGroup } from '../src/api.ts'
import { assessmentApiHandlers } from '../src/server/index.ts'
import { AssessmentLive } from '../src/live/service.ts'
import { connectionLedger, DEFAULT_CONNECTION_LIMITS } from '../src/live/connections.ts'
import type { AssessmentLiveEvent } from '../src/live/events.ts'
import { catalogLayers } from './support/catalogs.ts'
import { appointStaff } from './support/correction.ts'
import { ok, one, run, runningBatch, seed, stack } from './support/round.ts'

// Who hears what on a batch's event stream, served as the browser reaches
// it: a cookie, the route, the SSE body.
//
// The results roster shows everybody's current total, and a total moves
// when a claim, a round or a result does. So whoever reads that roster -
// its administrators, and whoever re-determines over the people on it
// (ruling of 2026-09-25 #33) - hears those three kinds, the way a reviewer
// and a recorder already did. A participant still hears only their own.

const COOKIE = 'qualy_session'

let db: Awaited<ReturnType<typeof createTestContext>>
let web: { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }
let batchId: string

/** the kinds this session hears, until a wake-up everybody hears comes through */
const heard = async (token: string): Promise<readonly string[]> => {
  const abort = new AbortController()
  const response = await web.handler(
    new Request(`http://qualy.test${QUALY_API_PREFIX}/assessment/batches/${batchId}/events`, {
      headers: { cookie: `${COOKIE}=${token}` },
      signal: abort.signal,
    }),
  )
  expect(response.status).toBe(200)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + 10_000
  try {
    // the paper changing is heard by everybody who may watch the batch, and
    // it is announced last: once it is through, so is everything before it
    while (!text.includes('"kind":"item-changed"') && Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), deadline - Date.now()),
        ),
      ])
      if (next.done) break
      text += decoder.decode(next.value, { stream: true })
    }
  } finally {
    abort.abort()
    await reader.cancel().catch(() => undefined)
  }
  return [...text.matchAll(/"kind":"([a-z-]+)"/g)].map((match) => match[1]!)
}

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
    web = HttpRouter.toWebHandler(
      HttpApiBuilder.layer(Api.local(assessmentApiGroup)).pipe(
        Layer.provide(assessmentApiHandlers),
        Layer.provideMerge(
          Layer.mergeAll(
            live,
            sessionLayer.pipe(Layer.provide(authConfig)),
            catalogLayers,
            HttpServer.layerServices,
          ),
        ),
        Layer.provideMerge(stack(db.url)),
      ),
      { disableLogger: true },
    )
  }, 120_000)

  afterAll(async () => {
    await web?.dispose()
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
