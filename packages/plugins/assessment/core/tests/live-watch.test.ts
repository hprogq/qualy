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
import { DEFAULT_CONNECTION_LIMITS } from '../src/live/connections.ts'
import { catalogLayers } from './support/catalogs.ts'
import { ok, one, run, runningBatch, seed, stack } from './support/round.ts'

// The ledger's own suite proves it counts; this one proves the batch event
// stream is served through it. Served as the browser reaches it - a cookie,
// the route, the SSE body - so a handler that returned its stream without
// asking the ledger would hold every connection a session opened.

const COOKIE = 'qualy_session'
const token = 'live-watch-token'

let db: Awaited<ReturnType<typeof createTestContext>>
let web: { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }
let batchId: string

describe.runIf(postgresAvailable)('the batch event stream, as served', () => {
  beforeAll(async () => {
    db = await createTestContext('assessment-live-watch')
    const seeded = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('live-watch')
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
          return { batchId: g.batch.id }
        }),
      ),
    )
    batchId = seeded.batchId
    const authConfig = Layer.succeed(
      AuthConfig,
      AuthConfig.of({
        defaultTenantSlug: 'live-watch',
        sessionTtlSeconds: 3600,
        secureCookies: false,
        sessionCookieName: COOKIE,
      }),
    )
    const services = stack(db.url)
    web = HttpRouter.toWebHandler(
      HttpApiBuilder.layer(Api.local(assessmentApiGroup)).pipe(
        Layer.provide(assessmentApiHandlers),
        // merged rather than provided: what a handler asks for is asked for
        // per request, from whatever the application layer holds
        Layer.provideMerge(
          Layer.mergeAll(
            AssessmentLive.layer.pipe(Layer.provide(assembledLayer)),
            sessionLayer.pipe(Layer.provide(authConfig)),
            catalogLayers,
            HttpServer.layerServices,
          ),
        ),
        Layer.provideMerge(services),
      ),
      { disableLogger: true },
    )
  }, 120_000)

  afterAll(async () => {
    await web?.dispose()
    await db?.dispose()
  })

  it('holds one session to its share of open streams, and tells the next to read and poll', async () => {
    const open = (signal?: AbortSignal) =>
      web.handler(
        new Request(`http://qualy.test${QUALY_API_PREFIX}/assessment/batches/${batchId}/events`, {
          headers: { cookie: `${COOKIE}=${token}` },
          ...(signal === undefined ? {} : { signal }),
        }),
      )
    const held: { abort: AbortController; reader: ReadableStreamDefaultReader<Uint8Array> }[] = []
    try {
      for (let at = 0; at < DEFAULT_CONNECTION_LIMITS.perSession; at += 1) {
        const abort = new AbortController()
        const response = await open(abort.signal)
        expect(response.status).toBe(200)
        const reader = response.body!.getReader()
        // the first event is on its way once the stream is counted
        const first = await reader.read()
        expect(new TextDecoder().decode(first.value)).toContain('sync')
        held.push({ abort, reader })
      }
      // one more from the same session: the one event, and the stream ends
      const cut = new AbortController()
      const past = await open(cut.signal)
      expect(past.status).toBe(200)
      const body = await Promise.race([
        past.text(),
        new Promise<string>((resolve) => setTimeout(() => resolve('still open'), 5_000)),
      ])
      cut.abort()
      expect(body.match(/"kind":"sync"/g)).toHaveLength(1)
    } finally {
      for (const one of held) {
        one.abort.abort()
        await one.reader.cancel().catch(() => undefined)
      }
    }
  }, 60_000)
})
