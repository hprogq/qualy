import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { authClosure } from './support/closure.ts'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { kyselyOf, type Orm } from '@qualy/plugin-database/server'
import { PermissionCatalog, Rbac } from '@qualy/rbac-contract/effect'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { layer as rbacLayer } from '@qualy/plugin-rbac/server'
import { loginDriversLayer } from '@qualy/auth-contract/login'
import { Iam, layer as authLayer } from '../src/server/index.ts'
import { AuthConfig } from '../src/server/auth-config.ts'
import { placementLegal } from '../src/server/placement.ts'
import { authEntityManager } from '../src/server/db.ts'
import { sql as ksql } from 'kysely'

// The identity behaviours the cordis suite asserted and the Effect suite did
// not. Each names the cordis test it comes from.

const catalog: readonly ActivePermission[] = [
  { code: 'auth.user.read', name: 'read users', target: 'org-node', plugin: 'auth' },
  { code: 'auth.user.manage', name: 'manage users', target: 'org-node', plugin: 'auth' },
]

const stack = (url: string) =>
  authLayer.pipe(
    Layer.provideMerge(rbacLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        databaseFor(url, { entities: authClosure }),
        Layer.succeed(PermissionCatalog, catalog),
        loginDriversLayer,
        uiLayer,
        Layer.succeed(
          AuthConfig,
          AuthConfig.of({
            defaultTenantSlug: 'default',
            sessionTtlSeconds: 604_800,
            secureCookies: false,
          }),
        ),
      ),
    ),
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Iam | Rbac | Orm | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

/** the rule the writes decide by, asked of one person through a caller's own query */
const legalFor = (userId: string) =>
  Effect.gen(function* () {
    const em = yield* authEntityManager()
    const row = yield* Effect.promise(() =>
      kyselyOf(em)
        .selectFrom('User as u')
        .innerJoin('UserType as t', 't.id', 'u.userTypeId')
        .innerJoin('OrgNode as n', 'n.id', 'u.primaryOrgNodeId')
        .where('u.id', '=', userId)
        .select((eb) =>
          placementLegal(
            {
              isSystem: eb.ref('t.isSystem'),
              placementMode: eb.ref('t.placementMode'),
              tenantId: eb.ref('t.tenantId'),
              id: eb.ref('t.id'),
            },
            eb.ref('n.orgTypeId'),
            ksql<boolean>`${eb.ref('n.parentId')} is null`,
          ).as('legal'),
        )
        .executeTakeFirst(),
    )
    return row!.legal
  })

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

const tagOf = (result: unknown) => (result as { failure?: { _tag?: string } }).failure?._tag

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** a tenant with a root, an administrator who reaches everything, and a plain type */
const seed = Effect.fn('seed')(function* () {
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('default','T') returning id`),
  ).id
  const orgType = one<{ id: string }>(
    yield* runSql(
      sql`insert into org_types (tenant_id, code, name) values (${tenant},'u','U') returning id`,
    ),
  ).id
  const root = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${tenant}, ${orgType}, 'Root', 'r', 0) returning id`),
  ).id
  const staff = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
      values (${tenant},'staff','Staff', true, 'unrestricted') returning id`),
  ).id
  const systemType = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode, is_system)
      values (${tenant},'system-account','System', true, 'unrestricted', true) returning id`),
  ).id
  const admin = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Ada', ${staff}, ${root}) returning id`),
  ).id
  const adminRole = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
      values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
      returning id`),
  ).id
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id) values (${tenant}, ${admin}, ${adminRole})`)
  const principal: Principal = { tenantId: tenant, userId: admin, sessionId: 's' }
  return { tenant, orgType, root, staff, systemType, admin, principal }
})

describe.runIf(postgresAvailable).concurrent('what the cordis identity suite covered', () => {
  it('gives a user type no authority of its own', async () => {
    // from iam.test.ts of the same name. A type says who someone is and where
    // they may stand; it carries no permission and no role, so a holder of a
    // brand new one reaches nothing until a grant says otherwise.
    const db = await createTestContext('effect-auth-parity-authority')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const rbac = yield* Rbac
          const auditorType = yield* iam.userTypes.create(f.tenant, {
            code: 'auditor',
            name: 'Auditor',
            placementPolicy: { mode: 'unrestricted' },
          })
          const auditor = yield* iam.users.create(
            f.tenant,
            { displayName: 'Auditor', userTypeId: auditorType, primaryOrgNodeId: f.root },
            f.principal,
          )
          const asAuditor: Principal = { tenantId: f.tenant, userId: auditor, sessionId: 's' }
          return {
            profile: yield* rbac.getProfile(asAuditor),
            visible: yield* iam.users.list(asAuditor, {
              orgNodeId: f.root,
              scope: 'subtree',
              limit: 50,
            }),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.profile).toEqual({ tenantPermissions: [], orgPermissions: [] })
      // and holding a type is not a way to read the people who share it
      expect(answer.visible).toEqual([])
    } finally {
      await db.dispose()
    }
  })

  it('refuses a business number another person in the tenant already has', async () => {
    // from iam.test.ts 'creates users and enforces the business number'. There
    // is no service check for this: the unique index is the whole rule, so the
    // translation is what turns it into a conflict rather than a 500.
    const db = await createTestContext('effect-auth-parity-business-no')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const create = (displayName: string, businessNo: string) =>
            Effect.result(
              iam.users.create(
                f.tenant,
                { displayName, userTypeId: f.staff, primaryOrgNodeId: f.root, businessNo },
                f.principal,
              ),
            )
          const first = yield* create('First', '2024001')
          const second = yield* create('Second', '2024001')
          // the same number in another tenant is a different person's number
          const elsewhere = one<{ id: string }>(
            yield* runSql(sql`insert into tenants (slug, name) values ('other','O') returning id`),
          ).id
          return { first, second, elsewhere }
        }),
      )
      const answer = ok(exit)
      expect(tagOf(answer.first)).toBeUndefined()
      expect(tagOf(answer.second)).toBe('USER_CONFLICT')
    } finally {
      await db.dispose()
    }
  })

  it('pins a system identity to the tenant root whatever its row stores', async () => {
    // from iam.test.ts of the same name. The row says "anywhere"; the rule
    // enforced is "the root and nowhere else", because authority over a person
    // is authority over the node they stand at, and every node below the root
    // has managers who are not the tenant's own administrators.
    //
    // The account is inserted rather than created: handing out a system type
    // is refused outright, which is a different rule and covered by the type
    // tests. What is under test here is where such a person may stand.
    const db = await createTestContext('effect-auth-parity-system')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const below = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.root}, ${f.orgType}, 'Below', 'r.b', 1) returning id`),
          ).id
          const stored = one<{ placement_mode: string }>(
            yield* runSql(sql`select placement_mode from user_types where id = ${f.systemType}`),
          ).placement_mode
          const system = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'System', ${f.systemType}, ${f.root}) returning id`),
          ).id
          // the predicate the writes decide by, asked of the node below: a
          // system identity standing there would be illegal, so retyping that
          // node is what the scan reports
          const legalAtRoot = yield* legalFor(system)
          yield* runSql(sql`
            update users set primary_org_node_id = ${below} where id = ${system}`)
          const legalBelow = yield* legalFor(system)
          return { stored, legalAtRoot, legalBelow }
        }),
      )
      const answer = ok(exit)
      expect(answer.stored).toBe('unrestricted')
      expect(answer.legalAtRoot).toBe(true)
      // the stored mode says anywhere; the enforced rule ignores it entirely
      expect(answer.legalBelow).toBe(false)
    } finally {
      await db.dispose()
    }
  })

  it('pages instead of truncating in silence', async () => {
    // from iam.test.ts of the same name. A bare limit drops the rest without
    // saying so; a keyset page resumes after the last row rather than
    // repeating it.
    const db = await createTestContext('effect-auth-parity-paging')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          for (const name of ['Paged 1', 'Paged 2', 'Paged 3']) {
            yield* iam.users.create(
              f.tenant,
              { displayName: name, userTypeId: f.staff, primaryOrgNodeId: f.root },
              f.principal,
            )
          }
          const page = (after?: readonly string[]) =>
            iam.users.list(f.principal, {
              orgNodeId: f.root,
              scope: 'subtree',
              search: 'Paged',
              after,
              limit: 2,
            })
          const first = yield* page()
          const last = first.at(-1)!
          const next = yield* page([last.displayName, last.id])
          return {
            first: first.map((row) => row.displayName),
            next: next.map((row) => row.displayName),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.first).toEqual(['Paged 1', 'Paged 2'])
      // resumes after the last row rather than repeating it
      expect(answer.next).toEqual(['Paged 3'])
    } finally {
      await db.dispose()
    }
  })

  it('lets exactly one of two concurrent attempts disable the last administrators', async () => {
    // from iam.test.ts 'serializes concurrent attempts to disable the last
    // administrators'. The tenant row lock is what forces the second
    // transaction to read the first one's result rather than its own snapshot.
    const db = await createTestContext('effect-auth-parity-race')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const second = yield* iam.users.create(
            f.tenant,
            { displayName: 'Second admin', userTypeId: f.staff, primaryOrgNodeId: f.root },
            f.principal,
          )
          const adminRole = one<{ id: string }>(
            yield* runSql(
              sql`select id from roles where tenant_id = ${f.tenant} and system_key is not null`,
            ),
          ).id
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id)
            values (${f.tenant}, ${second}, ${adminRole})`)
          const disable = (userId: string) =>
            Effect.result(iam.users.setEnabled(f.tenant, userId, false, f.principal))
          const [a, b] = yield* Effect.all([disable(f.admin), disable(second)], {
            concurrency: 2,
          })
          const alive = one<{ count: number }>(
            yield* runSql(sql`
              select count(*)::int as count from users u
              join role_grants g on g.tenant_id = u.tenant_id and g.user_id = u.id
              where g.role_id = ${adminRole} and u.enabled`),
          ).count
          return { tags: [tagOf(a), tagOf(b)], alive }
        }),
      )
      const answer = ok(exit)
      // Exactly one committed. Which failure the other gets depends on the
      // order they serialize in: disabling the actor first leaves them without
      // the authority to disable the second, so that transaction is refused as
      // ACCESS_DENIED rather than by the invariant. Both are correct, and
      // pinning one would pin the interleaving instead of the guarantee.
      const refused = answer.tags.filter((tag) => tag !== undefined)
      expect(refused).toHaveLength(1)
      expect(['LAST_ADMINISTRATOR', 'ACCESS_DENIED']).toContain(refused[0])
      expect(answer.alive).toBe(1)
    } finally {
      await db.dispose()
    }
  })
})
