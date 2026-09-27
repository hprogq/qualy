import { literal } from '@qualy/i18n-contract'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { Api } from '@qualy/api-kit/local'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { Authenticated, CurrentUser } from '@qualy/auth-contract/session'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import type { ActivePermission } from '@qualy/rbac-contract'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { Rbac } from '@qualy/rbac-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { entities as rbacEntities } from '../src/db/entities.ts'
import { accessApiGroup } from '../src/api.ts'
import { accessApiHandlers, serviceLayer as rbacLayer } from '../src/server/index.ts'
import { accessActions } from '../src/actions.ts'

// What the grant form is told, read through the handlers the browser calls.
//
// The service suite proves each candidate's refusal; which of them reach the
// reader, and where the form offers a scope at all, is decided in the
// handlers, and nothing else would notice them deciding it differently.

const catalog: readonly ActivePermission[] = [
  ...compileCatalog([{ owner: 'rbac', permissions: rbacPermissions }]),
  { code: 'org.tree.manage', name: literal('manage'), target: 'org-node', plugin: 'org' },
]

const closure = [...orgEntities, ...authEntities, ...rbacEntities, ...auditEntities] as const

const stack = (url: string) =>
  booted(
    rbacLayer.pipe(
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([{ owner: 'rbac', actions: accessActions }]),
            ),
          ),
        ),
      ),
      Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
    ),
    { catalog },
  )

/** whoever the request names, in the tenant under test: the session is not what is tested */
const asNamed = (tenantId: string) =>
  Layer.succeed(
    Authenticated,
    Authenticated.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const userId = request.headers['x-probe-user'] ?? ''
        return yield* Effect.provideService(httpEffect, CurrentUser, {
          tenantId,
          userId,
          sessionId: 'probe',
        })
      }),
    ),
  )

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

const seed = (url: string) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const tenant = one<{ id: string }>(
        yield* runSql(sql`insert into tenants (slug, name) values ('t', 'T') returning id`),
      ).id
      yield* runSql(sql`
        insert into auth_providers (tenant_id, code, type, name)
        values (${tenant}, 'local', 'local', 'Local')`)
      const unitType = one<{ id: string }>(
        yield* runSql(
          sql`insert into org_types (tenant_id, name) values (${tenant}, 'U') returning id`,
        ),
      ).id
      const root = one<{ id: string }>(
        yield* runSql(sql`
          insert into org_nodes (tenant_id, org_type_id, name, path, depth)
          values (${tenant}, ${unitType}, 'Root', 'r', 0) returning id`),
      ).id
      const child = one<{ id: string }>(
        yield* runSql(sql`
          insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
          values (${tenant}, ${root}, ${unitType}, 'Child', 'r.c', 1) returning id`),
      ).id
      const staff = one<{ id: string }>(
        yield* runSql(sql`
          insert into user_types (tenant_id, code, name, placement_mode)
          values (${tenant}, 'staff', 'Staff', 'unrestricted') returning id`),
      ).id
      const person = (name: string) =>
        Effect.map(
          runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${tenant}, ${name}, ${staff}, ${root}) returning id`),
          (result) => one<{ id: string }>(result).id,
        )
      const permission = (code: string, target: 'org-node' | 'tenant', plugin = 'rbac') =>
        Effect.map(
          runSql(sql`
            insert into permissions (code, plugin, name, target_kind)
            values (${code}, ${plugin}, ${code}, ${target})
            on conflict (code) do update set code = excluded.code returning id`),
          (result) => one<{ id: string }>(result).id,
        )
      const role = (
        code: string,
        kind: 'org' | 'tenant',
        permissions: readonly string[],
        assignable = true,
      ) =>
        Effect.gen(function* () {
          const created = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode,
                                 eligibility_mode, anchor_mode, assignable)
              values (${tenant}, ${code}, ${code}, ${kind}, 'active', 'explicit', 'unrestricted',
                      ${kind === 'org' ? 'unrestricted' : null}, ${assignable})
              returning id`),
          ).id
          for (const id of permissions) {
            yield* runSql(sql`
              insert into role_permissions (tenant_id, role_id, permission_id)
              values (${tenant}, ${created}, ${id})`)
          }
          return created
        })
      const grantManage = yield* permission('iam.grant.manage', 'org-node')
      const tenantGrantManage = yield* permission('iam.tenant-grant.manage', 'tenant')
      const tree = yield* permission('org.tree.manage', 'org-node', 'org')
      // an office its holders may appoint to others, and never to itself
      const collegeAdmin = yield* role('college-admin', 'org', [grantManage, tree])
      const counsellor = yield* role('counsellor', 'org', [tree])
      yield* role('foreign', 'org', [tree])
      // offices closed to new grants: one the dean may appoint, one the dean
      // holds, and one that is none of the dean's business
      const retired = yield* role('retired', 'org', [tree], false)
      const emeritus = yield* role('emeritus', 'org', [tree], false)
      yield* role('shelved', 'org', [tree], false)
      const tenantDesk = yield* role('tenant-desk', 'tenant', [tenantGrantManage])
      yield* runSql(sql`
        insert into role_grant_rules (tenant_id, granter_role_id, target_role_id)
        values (${tenant}, ${collegeAdmin}, ${counsellor}),
               (${tenant}, ${collegeAdmin}, ${retired})`)
      // the tenant's administrator role, which only its holders may give
      const administrator = one<{ id: string }>(
        yield* runSql(sql`
          insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key,
                             eligibility_mode)
          values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin',
                  'unrestricted')
          returning id`),
      ).id
      const head = yield* person('Head')
      yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id)
        values (${tenant}, ${head}, ${administrator})`)
      const dean = yield* person('Dean')
      const desk = yield* person('Desk')
      const li = yield* person('Li')
      // gives authority over one unit only: the reach it holds is the unit
      const clerk = yield* person('Clerk')
      yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
        values (${tenant}, ${dean}, ${collegeAdmin}, ${root}, 'subtree'),
               (${tenant}, ${dean}, ${emeritus}, ${root}, 'subtree'),
               (${tenant}, ${clerk}, ${collegeAdmin}, ${child}, 'self')`)
      yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id)
        values (${tenant}, ${desk}, ${tenantDesk})`)
      return { tenant, root, child, head, dean, desk, li, clerk }
    }).pipe(Effect.provide(databaseFor(url, { entities: closure }))),
  )

// the served stack holds pool connections, and the scratch database is
// dropped only once they are let go
let dispose: (() => Promise<void>) | undefined
const letGo = async () => {
  await dispose?.()
  dispose = undefined
}
afterEach(letGo)

describe.runIf(postgresAvailable)('the grant form, as served', () => {
  const serve = (url: string, tenantId: string) => {
    const web = HttpRouter.toWebHandler(
      HttpApiBuilder.layer(Api.local(accessApiGroup)).pipe(
        Layer.provide(accessApiHandlers),
        Layer.provideMerge(Layer.mergeAll(asNamed(tenantId), HttpServer.layerServices)),
        Layer.provideMerge(stack(url)),
      ),
      { disableLogger: true },
    )
    dispose = web.dispose
    return (path: string, userId: string) =>
      web
        .handler(
          new Request(`http://qualy.test${QUALY_API_PREFIX}${path}`, {
            headers: { 'x-probe-user': userId },
          }),
        )
        .then(async (response) => ({ status: response.status, body: await response.json() }))
  }

  it('lists the offices the reader holds and may not fill, and leaves the rest of the catalog out', async () => {
    const db = await createTestContext('rbac-grant-options-http')
    try {
      const f = ok(await seed(db.url))
      const ask = serve(db.url, f.tenant)
      const answer = await ask(
        `/iam/role-grant-options?userId=${f.li}&target=org-node&orgNodeId=${f.child}&coverage=self`,
        f.dean,
      )
      expect(answer.status).toBe(200)
      const body = answer.body as {
        reach: string
        roles: { code: string }[]
        refused: { code: string; refusal: string }[]
      }
      expect(body.reach).toBe('within')
      expect(body.roles.map((role) => role.code)).toEqual(['counsellor'])
      // the dean's own office is one they will look for, and is said to be
      // beyond them; an office closed to new grants is said to be closed to
      // whoever holds or appoints it; an office they neither hold nor fill
      // is no part of it, closed or not
      expect(Object.fromEntries(body.refused.map((role) => [role.code, role.refusal]))).toEqual({
        'college-admin': 'authority',
        retired: 'closed',
        emeritus: 'closed',
      })
    } finally {
      await letGo()
      await db.dispose()
    }
  })

  // Administering grants over one unit and asking about its subtree is not
  // a question of which offices the reader may appoint: it is one answer for
  // all of them, and "you cannot appoint this office" would be the wrong one.
  it('says the reach stands in the way rather than naming offices beyond the reader', async () => {
    const db = await createTestContext('rbac-grant-options-reach-http')
    try {
      const f = ok(await seed(db.url))
      const ask = serve(db.url, f.tenant)
      const at = (node: string, coverage: 'self' | 'subtree') =>
        ask(
          `/iam/role-grant-options?userId=${f.li}&target=org-node&orgNodeId=${node}&coverage=${coverage}`,
          f.clerk,
        )
      const subtree = await at(f.child, 'subtree')
      expect(subtree.status).toBe(200)
      expect(subtree.body).toEqual({ reach: 'unit-only', roles: [], refused: [] })
      // over the unit alone the clerk appoints what the office appoints, and
      // the office itself, which appoints nothing like it, is theirs to hold
      // and not to fill
      const self = await at(f.child, 'self')
      expect(self.status).toBe(200)
      const body = self.body as {
        reach: string
        roles: { code: string }[]
        refused: { code: string; refusal: string }[]
      }
      expect(body.reach).toBe('within')
      expect(body.roles.map((role) => role.code)).toEqual(['counsellor'])
      expect(body.refused).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'college-admin', refusal: 'authority' }),
        ]),
      )
      // above the unit nothing of the clerk's reaches
      expect((await at(f.root, 'self')).body).toMatchObject({ reach: 'outside', roles: [] })
    } finally {
      await letGo()
      await db.dispose()
    }
  })

  // Somebody who gives no authority here is not the one to learn who is there.
  it('asks the reach before the person, as the write does', async () => {
    const db = await createTestContext('rbac-grant-options-probe-http')
    try {
      const f = ok(await seed(db.url))
      const ask = serve(db.url, f.tenant)
      const nobody = '00000000-0000-7000-8000-000000000000'
      const outsider = await ask(`/iam/role-grant-options?userId=${nobody}&target=tenant`, f.li)
      expect(outsider.status).toBe(200)
      expect(outsider.body).toEqual({ reach: 'outside', roles: [], refused: [] })
      // one who does is told there is nobody there
      const insider = await ask(`/iam/role-grant-options?userId=${nobody}&target=tenant`, f.desk)
      expect(insider.status).toBe(404)
      expect(insider.body).toMatchObject({ _tag: 'GRANT_USER_NOT_FOUND' })
    } finally {
      await letGo()
      await db.dispose()
    }
  })

  // The form names an office closed to new grants to whoever holds or
  // appoints it; the port other plugins pick roles through never offered one
  // and still does not.
  it('keeps offices closed to new grants out of the port other plugins ask', async () => {
    const db = await createTestContext('rbac-grantable-port-closed')
    try {
      const f = ok(await seed(db.url))
      const offered = ok(
        await Effect.runPromiseExit(
          Effect.gen(function* () {
            const rbac = yield* Rbac
            return yield* rbac.listGrantableRoles({
              tenantId: f.tenant,
              actor: { tenantId: f.tenant, userId: f.dean, sessionId: 'probe' },
              userId: f.li,
              orgNodeId: f.child,
              coverage: 'self',
            })
          }).pipe(Effect.provide(stack(db.url))),
        ),
      )
      const codes = offered.map((role) => role.code)
      expect(codes).toContain('counsellor')
      expect(codes).not.toContain('retired')
      expect(codes).not.toContain('emeritus')
    } finally {
      await db.dispose()
    }
  })

  it('marks the administrator role among the roles on offer', async () => {
    const db = await createTestContext('rbac-grant-administrator-http')
    try {
      const f = ok(await seed(db.url))
      const ask = serve(db.url, f.tenant)
      const answer = await ask(`/iam/role-grant-options?userId=${f.li}&target=tenant`, f.head)
      expect(answer.status).toBe(200)
      const roles = (answer.body as { roles: { code: string; administrator: boolean }[] }).roles
      expect(Object.fromEntries(roles.map((role) => [role.code, role.administrator]))).toEqual({
        admin: true,
        'tenant-desk': false,
      })
    } finally {
      await letGo()
      await db.dispose()
    }
  })

  it('offers the form only the scopes the reader may grant in', async () => {
    const db = await createTestContext('rbac-grantable-http')
    try {
      const f = ok(await seed(db.url))
      const ask = serve(db.url, f.tenant)
      const byUnit = await ask(`/iam/users/${f.li}/role-grants`, f.dean)
      const byTenant = await ask(`/iam/users/${f.li}/role-grants`, f.desk)
      const nobody = await ask(`/iam/users/${f.li}/role-grants`, f.li)
      expect(byUnit.body).toMatchObject({ grantable: { tenant: false, organization: true } })
      expect(byTenant.body).toMatchObject({ grantable: { tenant: true, organization: false } })
      expect(nobody.body).toMatchObject({ grantable: { tenant: false, organization: false } })
    } finally {
      await letGo()
      await db.dispose()
    }
  })
})
