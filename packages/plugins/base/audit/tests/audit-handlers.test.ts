import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Api } from '@qualy/api-kit/local'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, QUALY_API_PREFIX } from '@qualy/api-kit'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { Authenticated, CurrentUser } from '@qualy/auth-contract/session'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import type { Principal } from '@qualy/rbac-contract'
import { createTestContext, databaseFor, postgresAvailable } from '@qualy/plugin-database/testkit'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as auditEntities } from '../src/db/entities.ts'
import { auditApiGroup } from '../src/api.ts'
import { auditApiHandlers } from '../src/server/index.ts'

const closure = [...orgEntities, ...authEntities, ...auditEntities] as const
const actor = '11111111-1111-4111-8111-111111111111'
const otherActor = '22222222-2222-4222-8222-222222222222'

interface Page {
  items: { id: string; actionCode: string; actorUserId: string; targetId: string }[]
  total: number
  page: number
  pageSize: number
}

describe.runIf(postgresAvailable)('the audit numbered pages, as served', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  let web: { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }
  let tenant: string
  let foreignTenant: string
  let expectedIds: string[]
  const requirePermission = vi.fn((principal: Principal, code: string) =>
    principal.userId === actor && code === 'audit.event.read'
      ? Effect.void
      : Effect.fail(new AccessDenied({ reason: 'not granted' })),
  )

  beforeAll(async () => {
    db = await createTestContext('audit-pages-http')
    tenant = (
      await db.row<{ id: string }>(
        "insert into tenants (slug, name) values ('t', 'T') returning id",
      )
    ).id
    foreignTenant = (
      await db.row<{ id: string }>(
        "insert into tenants (slug, name) values ('u', 'U') returning id",
      )
    ).id
    // Each group of three shares an instant down to microseconds. UUID breaks
    // those ties, while timestamps determine the order between groups.
    await db.query(
      `insert into audit_events
       (tenant_id, occurred_at, action_code, action_version, actor_kind, actor_user_id,
        target_kind, target_id, outcome, details, source)
       select $1, '2026-10-01T00:00:00.123456Z'::timestamptz + ((n - 1) / 3) * interval '1 second',
              'audit.test.read', 1, 'user', $2, 'auth.user', 'target', 'success', '{}', 'system'
       from generate_series(1, 105) n`,
      [tenant, actor],
    )
    await db.query(
      `insert into audit_events
       (tenant_id, occurred_at, action_code, action_version, actor_kind, actor_user_id,
        target_kind, target_id, outcome, details, source)
       values ($1, '2026-10-02T00:00:00Z', 'audit.test.denied', 1, 'user', $2,
               'org.node', 'other', 'denied', '{}', 'system'),
              ($3, '2026-10-01T00:00:00.123456Z', 'audit.test.read', 1, 'user', $4,
               'auth.user', 'target', 'success', '{}', 'system')`,
      [tenant, otherActor, foreignTenant, actor],
    )
    expectedIds = (
      await db.query<{ id: string }>(
        'select id from audit_events where tenant_id = $1 order by occurred_at desc, id desc',
        [tenant],
      )
    ).rows.map((row) => row.id)

    const asNamed = Layer.succeed(
      Authenticated,
      Authenticated.of((httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* Effect.provideService(httpEffect, CurrentUser, {
            tenantId: request.headers['x-probe-tenant'] ?? tenant,
            userId: request.headers['x-probe-user'] ?? actor,
            sessionId: 'audit-probe',
          })
        }),
      ),
    )
    web = HttpRouter.toWebHandler(
      HttpApiBuilder.layer(Api.local(auditApiGroup)).pipe(
        Layer.provide(auditApiHandlers),
        Layer.provideMerge(Layer.mergeAll(asNamed, HttpServer.layerServices)),
        Layer.provideMerge(databaseFor(db.url, { entities: closure })),
        Layer.provideMerge(Layer.succeed(AuditActionCatalog, [])),
        // This boundary test asserts the permission and principal passed to
        // RBAC; the policy graph is covered by the RBAC service suites.
        Layer.provideMerge(
          Layer.succeed(Rbac, { require: requirePermission } as unknown as Rbac['Service']),
        ),
      ),
      { disableLogger: true },
    )
  })

  afterAll(async () => {
    await web?.dispose()
    await db?.dispose()
  })

  const ask = async (query = '', headers: Record<string, string> = {}) => {
    const response = await web.handler(
      new Request(`http://qualy.test${QUALY_API_PREFIX}/audit/events${query}`, { headers }),
    )
    const text = await response.text()
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as Page }
  }

  it('counts the whole tenant and permits direct first, middle and last-page navigation', async () => {
    const first = await ask()
    const second = await ask('?page=2')
    const last = await ask('?page=999')
    expect([first.status, second.status, last.status]).toEqual([200, 200, 200])
    expect(first.body).toMatchObject({ total: 106, page: 1, pageSize: DEFAULT_PAGE_SIZE })
    expect(second.body).toMatchObject({ total: 106, page: 2, pageSize: DEFAULT_PAGE_SIZE })
    expect(last.body).toMatchObject({ total: 106, page: 3, pageSize: DEFAULT_PAGE_SIZE })
    expect(first.body.items).toHaveLength(50)
    expect(second.body.items).toHaveLength(50)
    expect(last.body.items).toHaveLength(6)
    const ids = [first, second, last].flatMap((page) => page.body.items.map((row) => row.id))
    expect(ids).toEqual(expectedIds)
    expect(new Set(ids).size).toBe(106)
    expect((await ask('?page=2')).body).toEqual(second.body)
    expect(first.body).not.toHaveProperty('nextCursor')
  })

  it('counts every filter in the same scope as its items, including both date bounds', async () => {
    const filters = new URLSearchParams({
      actionCode: 'audit.test.read',
      actorUserId: actor,
      outcome: 'success',
      targetKind: 'auth.user',
      targetId: 'target',
      from: '2026-10-01T00:00:01.123456Z',
      to: '2026-10-01T00:00:03.123456Z',
      page: '2',
      limit: '4',
    })
    const filtered = await ask(`?${filters.toString()}`)
    expect(filtered.status).toBe(200)
    expect(filtered.body).toMatchObject({ total: 6, page: 2, pageSize: 4 })
    expect(filtered.body.items).toHaveLength(2)
    for (const row of filtered.body.items) {
      expect(row).toMatchObject({
        actionCode: 'audit.test.read',
        actorUserId: actor,
        targetId: 'target',
      })
    }
    for (const [key, missing] of Object.entries({
      actionCode: 'audit.test.missing',
      actorUserId: otherActor,
      outcome: 'failure',
      targetKind: 'missing',
      targetId: 'missing',
    })) {
      const unmatched = new URLSearchParams(filters)
      unmatched.set(key, missing)
      const answer = await ask(`?${unmatched.toString()}`)
      expect(answer.body).toEqual({ items: [], total: 0, page: 1, pageSize: 4 })
    }
    const foreign = await ask('?page=3', { 'x-probe-tenant': foreignTenant })
    expect(foreign.status).toBe(200)
    expect(foreign.body).toMatchObject({ total: 1, page: 1, pageSize: DEFAULT_PAGE_SIZE })
    expect(foreign.body.items).toHaveLength(1)
    expect(expectedIds).not.toContain(foreign.body.items[0]!.id)
    const empty = await ask('?targetId=missing&page=9')
    expect(empty.body).toEqual({ items: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE })
  })

  it('normalizes unusable page values and bounds the requested page size', async () => {
    for (const page of ['0', '-1', '1.5', 'NaN', 'Infinity']) {
      const answer = await ask(`?page=${page}&limit=0`)
      expect(answer.status).toBe(200)
      expect(answer.body).toMatchObject({ page: 1, pageSize: DEFAULT_PAGE_SIZE })
    }
    const capped = await ask('?limit=1000000')
    expect(capped.body.pageSize).toBe(MAX_PAGE_SIZE)
    expect(capped.body.items.length).toBeLessThanOrEqual(MAX_PAGE_SIZE)
  })

  it('rejects invalid dates and actor identifiers at the HTTP boundary', async () => {
    for (const query of [
      '?from=2026-02-30T00%3A00%3A00Z',
      '?to=not-a-timestamp',
      '?actorUserId=not-a-uuid',
    ]) {
      expect((await ask(query)).status).toBe(400)
    }
  })

  it('requires audit.event.read for the authenticated principal before reading a page', async () => {
    const answer = await ask('?page=2', { 'x-probe-user': otherActor })
    expect(answer.status).toBe(403)
    expect(answer.body).toMatchObject({ _tag: 'ACCESS_DENIED' })
    expect(requirePermission).toHaveBeenLastCalledWith(
      { tenantId: tenant, userId: otherActor, sessionId: 'audit-probe' },
      'audit.event.read',
    )
  })
})
