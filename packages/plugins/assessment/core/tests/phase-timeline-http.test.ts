import { createHash } from 'node:crypto'
import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Api } from '@qualy/api-kit/local'
import { assembledLayer } from '@qualy/api-kit/assembled'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { layer as sessionLayer } from '@qualy/plugin-auth/server/session'
import { AuthConfig } from '@qualy/plugin-auth/server/sign-in'
import { assessmentApiGroup } from '../src/api.ts'
import { Assessment, assessmentApiHandlers } from '../src/server/index.ts'
import { AssessmentLive } from '../src/live/service.ts'
import { catalogLayers } from './support/catalogs.ts'
import { ok, one, phase, run, runningBatch, seed, stack } from './support/round.ts'

// A stage kept to some of the roster, as the timeline serves it to whoever
// asks: the one it admits is told they are in, the one it leaves out that
// they are not, and a reader on no roster only that people are limited.
// The service suite proves the answer for a named reader; this one proves
// the reader named is the one signed in.

const COOKIE = 'qualy_session'
const tokens = { admitted: 'timeline-admitted', left: 'timeline-left', office: 'timeline-office' }

let db: Awaited<ReturnType<typeof createTestContext>>
let web: { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }
let batchId: string

describe.runIf(postgresAvailable)('a stage kept to some people, as served', () => {
  beforeAll(async () => {
    db = await createTestContext('assessment-timeline-http')
    batchId = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('timeline-http')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f)
          const plan = yield* assessment.getPlan(f.t, g.batch.id, admin)
          yield* assessment.replacePlan(
            f.t,
            g.batch.id,
            {
              specs: [
                { id: plan[0]!.id, phaseKey: plan[0]!.phaseKey, displayName: 'entry' },
                phase({
                  phaseKey: 'supplement',
                  permissionProfile: ['assessment.entry.create', 'assessment.entry.submit'],
                  participantScope: [g.p1],
                }),
                { id: plan[1]!.id, phaseKey: plan[1]!.phaseKey, displayName: 'archive' },
              ],
            },
            admin,
          )
          // somebody who administers the round and was never on its roster
          const staffType = one<{ id: string }>(
            yield* runSql(sql`
              insert into user_types (tenant_id, code, name, placement_mode)
              values (${f.t}, 'staff', 'Staff', 'unrestricted') returning id`),
          ).id
          const office = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Office', ${staffType}, ${f.root}) returning id`),
          ).id
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id)
            select ${f.t}, ${office}, id from roles where tenant_id = ${f.t} and code = 'admin'`)
          const door = one<{ id: string }>(
            yield* runSql(sql`
              insert into auth_providers (tenant_id, code, type, name, is_system)
              values (${f.t}, 'local', 'local', 'Local', true) returning id`),
          ).id
          for (const [userId, token] of [
            [f.s1, tokens.admitted],
            [f.s2, tokens.left],
            [office, tokens.office],
          ] as const) {
            const hash = createHash('sha256').update(token).digest('hex')
            yield* runSql(sql`
              insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
              values (${f.t}, ${userId}, ${door}, ${hash}, now() + interval '1 day')`)
          }
          return g.batch.id
        }),
      ),
    )
    const authConfig = Layer.succeed(
      AuthConfig,
      AuthConfig.of({
        defaultTenantSlug: 'timeline-http',
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

  /** what each stage of the timeline says about its reader, as `token` reads it */
  const readerOf = async (token: string) => {
    const response = await web.handler(
      new Request(`http://qualy.test${QUALY_API_PREFIX}/assessment/batches/${batchId}/timeline`, {
        headers: { cookie: `${COOKIE}=${token}` },
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      timeline: readonly {
        displayName: string
        scope: { participantsLimited: boolean; includesReader: boolean | null }
      }[]
    }
    return body.timeline.map((stage) => [stage.displayName, stage.scope.includesReader])
  }

  it('tells the participant the stage admits that it admits them', async () => {
    expect(await readerOf(tokens.admitted)).toEqual([
      ['entry', null],
      ['supplement', true],
      ['archive', null],
    ])
  })

  it('tells a participant the stage leaves out that it does', async () => {
    expect(await readerOf(tokens.left)).toEqual([
      ['entry', null],
      ['supplement', false],
      ['archive', null],
    ])
  })

  it('says nothing about the reader to somebody on no roster', async () => {
    expect(await readerOf(tokens.office)).toEqual([
      ['entry', null],
      ['supplement', null],
      ['archive', null],
    ])
  })
})
