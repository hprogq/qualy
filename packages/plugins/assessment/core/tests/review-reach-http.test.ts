import { createHash } from 'node:crypto'
import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Api } from '@qualy/api-kit/local'
import { assembledLayer } from '@qualy/api-kit/assembled'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { layer as sessionLayer } from '@qualy/plugin-auth/server/session'
import { AuthConfig } from '@qualy/plugin-auth/server/sign-in'
import { assessmentApiGroup } from '../src/api.ts'
import { assessmentApiHandlers } from '../src/server/index.ts'
import { AssessmentLive } from '../src/live/service.ts'
import { catalogLayers } from './support/catalogs.ts'
import { ok, one, run, runningBatch, seed, stack } from './support/round.ts'

// Who a review route has nowhere to stand for, as the screens ask it: over
// the wire, with a session, one question's route or one composed set of
// unit kinds and never both. The service suite proves the answer; this one
// proves what a request that does not say which people it is about gets
// back, in the shape every other refusal on the api has.

const COOKIE = 'qualy_session'
const token = 'reach-http-token'

let db: Awaited<ReturnType<typeof createTestContext>>
let web: { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }
let fixture: { batchId: string; itemId: string; classType: string }

describe.runIf(postgresAvailable)('routes with nowhere to stand, as served', () => {
  beforeAll(async () => {
    db = await createTestContext('assessment-reach-http')
    fixture = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('reach-http')
          const g = yield* runningBatch(f)
          const door = one<{ id: string }>(
            yield* runSql(sql`
              insert into auth_providers (tenant_id, code, type, name, is_system)
              values (${f.t}, 'local', 'local', 'Local', true) returning id`),
          ).id
          const hash = createHash('sha256').update(token).digest('hex')
          yield* runSql(sql`
            insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
            values (${f.t}, ${f.admin}, ${door}, ${hash}, now() + interval '1 day')`)
          return { batchId: g.batch.id, itemId: g.item.id, classType: f.classType }
        }),
      ),
    )
    const authConfig = Layer.succeed(
      AuthConfig,
      AuthConfig.of({
        defaultTenantSlug: 'reach-http',
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
            AssessmentLive.layer.pipe(Layer.provide(assembledLayer)),
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

  const ask = async (query: string) => {
    const response = await web.handler(
      new Request(
        `http://qualy.test${QUALY_API_PREFIX}/assessment/batches/${fixture.batchId}/unreachable-participants${query}`,
        { headers: { cookie: `${COOKIE}=${token}` } },
      ),
    )
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }

  it('refuses a request that names both a question and unit kinds', async () => {
    const both = await ask(`?itemId=${fixture.itemId}&nodeTypeIds=${fixture.classType}`)
    expect(both.status).toBe(400)
    expect(both.body['_tag']).toBe('BAD_REQUEST')
  })

  it('refuses a request that names neither', async () => {
    const neither = await ask('')
    expect(neither.status).toBe(400)
    expect(neither.body['_tag']).toBe('BAD_REQUEST')
  })

  // `route` picks one of a saved question's two routes; a route still being
  // composed is the unit kinds themselves, so there is nothing for it to pick
  it('answers unit kinds alone, whatever route is named beside them', async () => {
    const plain = await ask(`?nodeTypeIds=${fixture.classType}`)
    const routed = await ask(`?nodeTypeIds=${fixture.classType}&route=escalation`)
    expect(plain.status).toBe(200)
    expect(plain.body['total']).toBe(2)
    expect(routed).toEqual(plain)
  })
})
