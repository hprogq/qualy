import { createServer } from 'node:http'
import { inspect } from 'node:util'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Api } from '@qualy/api-kit/local'
import { assembledLayer } from '@qualy/api-kit/assembled'
import { schemaRefusals } from '@qualy/api-kit/schema-refusal'
import { sessionCookieName } from '@qualy/auth-contract/session'
import { layer as sessionLayer } from '@qualy/plugin-auth/server/session'
import { AuthConfig } from '@qualy/plugin-auth/server/sign-in'
import { hashSessionToken } from '../../../base/auth/src/session.ts'
import { assessmentApiGroup } from '../src/api.ts'
import { Assessment, assessmentApiHandlers } from '../src/server/index.ts'
import { AssessmentLive } from '../src/live/service.ts'
import { ok, one, run, seed, stack } from './support/round.ts'

// The staff list over the wire, the way the page asks for it: the address's
// page, size and filters decoded from the query string, the answer's
// counts, and a filter the contract does not know refused in the one shape
// every refusal under the api has. The service suite cannot see any of
// that - it is handed typed values the handler already made.

const port = 3261
const base = `http://127.0.0.1:${port}`
const slug = 'access-http'
const token = 'access-http-token'

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>
let batchId = ''
let roleIds: readonly string[] = []

beforeAll(async () => {
  if (!postgresAvailable) return
  db = await createTestContext('access-http', { migrations: 'apply' })
  const services = stack(db.url)
  // the round's live stream, which its event endpoint reads; nothing here
  // listens to it, but the api is served with it as the host serves it
  const live = AssessmentLive.layer.pipe(Layer.provide(assembledLayer), Layer.provide(services))
  const authConfig = Layer.succeed(
    AuthConfig,
    AuthConfig.of({
      defaultTenantSlug: slug,
      sessionTtlSeconds: 3600,
      secureCookies: false,
      sessionCookieName: 'qualy_session',
    }),
  )
  const serving = HttpRouter.serve(
    Layer.mergeAll(
      HttpApiBuilder.layer(Api.local(assessmentApiGroup)).pipe(
        Layer.provide(
          assessmentApiHandlers.pipe(
            Layer.provide(services),
            Layer.provide(sessionLayer.pipe(Layer.provide(Layer.mergeAll(services, authConfig)))),
          ),
        ),
      ),
      // mounted as the host mounts it, so a query the contract will not
      // read is refused the way production refuses it
      schemaRefusals,
    ),
  ).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provide(services),
    Layer.provide(live),
  )
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(serving, scope))

  const seeded = ok(
    await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed(slug)
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.t,
          {
            name: 'Over the wire',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
          },
          f.principal(f.admin),
        )
        // two of the three lose what they held, so the lapsed are a list
        // long enough to page through one at a time
        yield* runSql(sql`
          update role_grants set revoked_at = now()
          where tenant_id = ${f.t} and user_id in (${f.recorder}, ${f.reviewer})`)
        // the administrator's session, through the door it came in by
        const door = one<{ id: string }>(
          yield* runSql(sql`
            insert into auth_providers (tenant_id, code, type, name, is_system)
            values (${f.t}, 'local', 'local', 'Local', true) returning id`),
        ).id
        yield* runSql(sql`
          insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
          values (${f.t}, ${f.admin}, ${door}, ${hashSessionToken(token)},
                  now() + interval '1 day')`)
        const roles = (yield* runSql(sql`
          select id from roles where tenant_id = ${f.t} order by name`)) as unknown as {
          rows: { id: string }[]
        }
        return { batchId: batch.id, roleIds: roles.rows.map((row) => row.id) }
      }),
    ),
  )
  batchId = seeded.batchId
  roleIds = seeded.roleIds
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope as Scope.Closeable, Exit.void))
  await db.dispose()
})

const get = async (path: string) => {
  const response = await fetch(`${base}${path}`, {
    headers: { cookie: `${sessionCookieName}=${token}` },
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // whatever came back is what the assertion sees
  }
  return { status: response.status, body }
}

interface StaffPage {
  staff: { userId: string; sources: { active: boolean }[]; effective: string[] }[]
  total: number
  page: number
  pageSize: number
  roles: { id: string; name: string; count: number }[]
}

describe.runIf(postgresAvailable)('the staff list over http', () => {
  it('reads the page, the size and the filters from the address and counts across pages', async () => {
    const lapsed = await get(
      `/api/assessment/batches/${batchId}/access?page=2&limit=1&standing=lapsed`,
    )
    expect(lapsed.status, inspect(lapsed.body)).toBe(200)
    const second = lapsed.body as StaffPage
    expect(second).toMatchObject({ total: 2, page: 2, pageSize: 1 })
    expect(second.staff).toHaveLength(1)
    expect(second.staff[0]!.sources.some((source) => !source.active)).toBe(true)
    // the roles to narrow by are every role held here, whatever the filter
    expect(second.roles.map((role) => role.id).sort()).toEqual(
      roleIds.filter((id) => second.roles.some((role) => role.id === id)).sort(),
    )
    expect(second.roles).toHaveLength(3)

    const able = await get(
      `/api/assessment/batches/${batchId}/access?permission=assessment.entry.record&standing=active`,
    )
    expect(able.status, inspect(able.body)).toBe(200)
    const kept = able.body as StaffPage
    expect(kept.total).toBe(kept.staff.length)
    for (const row of kept.staff) expect(row.effective).toContain('assessment.entry.record')

    // past the last page is the last page, not an empty one
    const far = await get(`/api/assessment/batches/${batchId}/access?page=40&limit=1`)
    expect(far.status, inspect(far.body)).toBe(200)
    expect(far.body).toMatchObject({ total: 3, page: 3, pageSize: 1 })
  })

  it('refuses a filter the contract does not know, in the shape every refusal has', async () => {
    for (const query of [
      'standing=everyone',
      'permission=assessment.batch.manage',
      'roleId=not-a-role',
    ]) {
      const refused = await get(`/api/assessment/batches/${batchId}/access?${query}`)
      expect(refused.status, query).toBe(400)
      expect(refused.body, query).toMatchObject({ _tag: 'BAD_REQUEST' })
    }
  })
})
