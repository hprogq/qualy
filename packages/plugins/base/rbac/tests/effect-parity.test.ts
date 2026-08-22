import { literal } from '@qualy/i18n-contract'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  pgCode,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { type Orm } from '@qualy/plugin-database/server'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '../src/db/entities.ts'
import { Rbac } from '@qualy/rbac-contract/effect'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { Access } from '../src/server/index.ts'
import { serviceLayer as rbacLayer } from '../src/server/index.ts'

// The behaviours the cordis suite asserted and the Effect suite did not.
//
// Both runtimes ran the same statements from queries.ts, so the cordis tests
// were the ones actually exercising much of that SQL. Deleting them without
// porting what they covered would not have failed anything - which is the
// whole reason to do it explicitly rather than trust that "the Effect tests
// cover it".
//
// Each test below names the cordis test it comes from, so a reader can check
// the claim rather than take it.

const catalog: readonly ActivePermission[] = [
  // rbac's real declarations plus the codes these fixtures grant: the catalog
  // is a prepare-phase value now, so the harness states the whole of it
  ...compileCatalog([{ owner: 'rbac', permissions: rbacPermissions }]),
  { code: 'org.tree.read', name: literal('read'), target: 'org-node', plugin: 'org' },
  { code: 'org.tree.manage', name: literal('manage'), target: 'org-node', plugin: 'org' },
  { code: 'iam.user.read', name: literal('users'), target: 'tenant', plugin: 'iam' },
]

// what the orm must know for a query to name a table
const closure = [...orgEntities, ...authEntities, ...rbacEntities] as const

const stack = (url: string) =>
  booted(
    rbacLayer.pipe(
      Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
    ),
    { catalog },
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Rbac | Access | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

/**
 * The code a refusal carries, or undefined when it succeeded.
 *
 * Reads `failure` rather than checking for `_tag === 'Failure'`: a Result does
 * not always carry that discriminant where a test can see it, and the version
 * that checked for it returned undefined for every refusal - which reads
 * exactly like a call that succeeded.
 */
const tagOf = (result: unknown) => {
  const value = result as { failure?: { _tag?: string } }
  return value.failure?._tag
}

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** two tenants, so isolation is a case rather than an assumption */
const seed = Effect.fn('seed')(function* () {
  const tenant = (slug: string) =>
    runSql(sql`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`)
  const a = one<{ id: string }>(yield* tenant('a')).id
  const b = one<{ id: string }>(yield* tenant('b')).id

  const setup = Effect.fn('setup')(function* (tenantId: string) {
    const orgType = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_types (tenant_id, name) values (${tenantId}, 'U') returning id`),
    ).id
    const root = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, name, path, depth)
        values (${tenantId}, ${orgType}, 'Root', 'r', 0) returning id`),
    ).id
    const child = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
        values (${tenantId}, ${root}, ${orgType}, 'Child', 'r.c', 1) returning id`),
    ).id
    const staff = one<{ id: string }>(
      yield* runSql(sql`
        insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
        values (${tenantId},'staff','Staff', true, 'unrestricted') returning id`),
    ).id
    // a type nobody can sign in with, for the "could still sign in" case
    const locked = one<{ id: string }>(
      yield* runSql(sql`
        insert into user_types (tenant_id, code, name, allow_local_login, allow_sso_login, placement_mode)
        values (${tenantId},'locked','Locked', false, false, 'unrestricted') returning id`),
    ).id
    const user = (name: string, type = staff) =>
      runSql(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
        values (${tenantId}, ${name}, ${type}, ${root}) returning id`)
    const admin = one<{ id: string }>(yield* user('Admin')).id
    const manager = one<{ id: string }>(yield* user('Manager')).id
    const adminRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
        values (${tenantId}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
        returning id`),
    ).id
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id) values (${tenantId}, ${admin}, ${adminRole})`)
    // an ordinary org role carrying one capability, anchored at the child
    const managerRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${tenantId}, 'mgr', 'Mgr', 'org', 'active', 'explicit', 'allow-list') returning id`),
    ).id
    const permission = one<{ id: string }>(
      yield* runSql(sql`
        insert into permissions (code, plugin, name, target_kind)
        values ('org.tree.manage', 'org', 'manage', 'org-node')
        on conflict (code) do update set code = excluded.code returning id`),
    ).id
    yield* runSql(sql`
      insert into role_permissions (tenant_id, role_id, permission_id)
      values (${tenantId}, ${managerRole}, ${permission})`)
    yield* runSql(sql`
      insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
      values (${tenantId}, ${managerRole}, ${staff})`)
    yield* runSql(sql`
      insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
      values (${tenantId}, ${managerRole}, ${orgType})`)
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
      values (${tenantId}, ${manager}, ${managerRole}, ${child}, 'subtree')`)
    return { tenantId, orgType, root, child, staff, locked, admin, manager, adminRole, managerRole }
  })

  return { a: yield* setup(a), b: yield* setup(b) }
})

const as = (tenantId: string, userId: string): Principal => ({ tenantId, userId, sessionId: 's' })

describe.runIf(postgresAvailable).concurrent('what the cordis suite covered', () => {
  it('stops authorizing through a role that is no longer active', async () => {
    // from rbac.test.ts 'fails closed on a role that is not active'. Disabling
    // a role must take its capabilities away immediately; the grant survives,
    // so a re-activation restores them without re-granting anything.
    const db = await createTestContext('effect-parity-inactive')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const rbac = yield* Rbac
          const manager = as(f.a.tenantId, f.a.manager)
          const before = yield* rbac.canAt(manager, 'org.tree.manage', f.a.child)
          yield* runSql(sql`update roles set status = 'disabled' where id = ${f.a.managerRole}`)
          const during = yield* rbac.canAt(manager, 'org.tree.manage', f.a.child)
          const profile = yield* rbac.getProfile(manager)
          yield* runSql(sql`update roles set status = 'active' where id = ${f.a.managerRole}`)
          const after = yield* rbac.canAt(manager, 'org.tree.manage', f.a.child)
          return { before, during, profile, after }
        }),
      )
      const answer = ok(exit)
      expect(answer.before).toBe(true)
      expect(answer.during).toBe(false)
      // and it disappears from discovery too, not only from the decision
      expect(answer.profile.orgPermissions).toEqual([])
      expect(answer.after).toBe(true)
    } finally {
      await db.dispose()
    }
  })

  it('keeps tenants apart, including when a principal names the wrong one', async () => {
    // from rbac.test.ts 'keeps tenants fully isolated'. The forged case is the
    // point: every query is tenant scoped, so pairing tenant A's user with
    // tenant B has to authorize nothing rather than fall back to A.
    const db = await createTestContext('effect-parity-tenants')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const rbac = yield* Rbac
          const adminOfB = as(f.b.tenantId, f.b.admin)
          const forged = as(f.b.tenantId, f.a.admin)
          return {
            // B's administrator reaches everything in B
            inOwn: yield* rbac.canAt(adminOfB, 'org.tree.manage', f.b.child),
            // and nothing in A, whose nodes are not even in scope
            inOther: yield* rbac.canAt(adminOfB, 'org.tree.manage', f.a.child),
            scopeInOther: yield* rbac.listAuthorizedScope(adminOfB, 'org.tree.read'),
            forged: yield* rbac.canAt(forged, 'org.tree.manage', f.b.child),
            forgedProfile: yield* rbac.getProfile(forged),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.inOwn).toBe(true)
      expect(answer.inOther).toBe(false)
      // tenant-wide inside B, which says nothing about A's nodes
      expect(answer.scopeInOther.tenantWide).toBe(true)
      expect(answer.forged).toBe(false)
      expect(answer.forgedProfile).toEqual({ tenantPermissions: [], orgPermissions: [] })
    } finally {
      await db.dispose()
    }
  })

  it('splits the profile by the role kind, never by the capability target', async () => {
    // from rbac.test.ts 'projects the profile from the role kind'. A tenant
    // capability held through an org role would apply at every node with no
    // grant having said so, so it is not tenant-wide discovery.
    const db = await createTestContext('effect-parity-profile')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const rbac = yield* Rbac
          return {
            admin: yield* rbac.getProfile(as(f.a.tenantId, f.a.admin)),
            manager: yield* rbac.getProfile(as(f.a.tenantId, f.a.manager)),
          }
        }),
      )
      const answer = ok(exit)
      // the administrator's role is tenant-kind and carries everything active
      expect(answer.admin.tenantPermissions).toContain('iam.role.manage')
      expect(answer.admin.orgPermissions).toContain('org.tree.manage')
      // the manager's role is org-kind, so nothing of theirs is tenant-wide
      expect(answer.manager.tenantPermissions).toEqual([])
      expect(answer.manager.orgPermissions).toEqual(['org.tree.manage'])
    } finally {
      await db.dispose()
    }
  })

  it('refuses at the database the rows the access model forbids', async () => {
    // from rbac.test.ts 'refuses rows that break the access model'. A
    // constraint earns its place by refusing what a service would never send,
    // so these go straight to SQL on purpose.
    const db = await createTestContext('effect-parity-constraints')
    try {
      const f = ok(await run(db.url, seed()))
      // holding every capability belongs to the provisioned administrator role
      expect(
        await pgCode(
          db.query(
            `insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
             values ($1,'rogue','Rogue','tenant','active','all-active','something-else')`,
            [f.a.tenantId],
          ),
        ),
      ).toBe('23514')
      // and with no system key at all, which is the shape that slipped through
      // once: a check evaluating to null is satisfied, so comparing a null key
      // with = accepted the row instead of rejecting it
      expect(
        await pgCode(
          db.query(
            `insert into roles (tenant_id, code, name, kind, status, permission_mode)
             values ($1,'rogue2','Rogue2','tenant','active','all-active')`,
            [f.a.tenantId],
          ),
        ),
      ).toBe('23514')
      // a tenant grant has no anchor, and an anchored one has both parts
      expect(
        await pgCode(
          db.query(
            `insert into role_grants (tenant_id, user_id, role_id, org_node_id)
             values ($1,$2,$3,$4)`,
            [f.a.tenantId, f.a.admin, f.a.adminRole, f.a.child],
          ),
        ),
      ).toBe('23514')
    } finally {
      await db.dispose()
    }
  })

  it('refuses a grant the role does not admit, for each reason separately', async () => {
    // from rbac.test.ts 'enforces grant eligibility'. Three independent facts:
    // who may hold the duty, where it may apply, and what shape the grant has.
    const db = await createTestContext('effect-parity-eligibility')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const actor = as(f.a.tenantId, f.a.admin)
          const outsider = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.a.tenantId}, 'Outsider', ${f.a.locked}, ${f.a.root}) returning id`),
          ).id
          const otherType = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_types (tenant_id, name)
              values (${f.a.tenantId}, 'Other') returning id`),
          ).id
          const elsewhere = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.a.tenantId}, ${f.a.root}, ${otherType}, 'Elsewhere', 'r.e', 1)
              returning id`),
          ).id
          const target = (orgNodeId: string) =>
            ({ kind: 'org-node', orgNodeId, coverage: 'self' }) as const
          const attempt = (userId: string, orgNodeId: string) =>
            Effect.result(
              access.grants.grant(
                f.a.tenantId,
                { userId, roleId: f.a.managerRole, target: target(orgNodeId) },
                actor,
              ),
            )
          return {
            // who may hold it is a fact about the role
            wrongType: yield* attempt(outsider, f.a.child),
            // where it applies is another
            wrongPlace: yield* attempt(f.a.manager, elsewhere),
            // and the kind of the role decides the grant's shape
            unanchored: yield* Effect.result(
              access.grants.grant(
                f.a.tenantId,
                { userId: f.a.manager, roleId: f.a.managerRole, target: { kind: 'tenant' } },
                actor,
              ),
            ),
          }
        }),
      )
      const answer = ok(exit)
      // the reason is a closed set, so a client can explain the refusal
      // precisely: asserting only the code would let all three collapse
      const reason = (result: unknown) =>
        (result as { failure?: { reason?: string } }).failure?.reason
      expect(tagOf(answer.wrongType)).toBe('GRANT_NOT_ELIGIBLE')
      expect(reason(answer.wrongType)).toBe('user-type')
      expect(tagOf(answer.wrongPlace)).toBe('GRANT_NOT_ELIGIBLE')
      expect(reason(answer.wrongPlace)).toBe('org-type')
      expect(tagOf(answer.unanchored)).toBe('GRANT_NOT_ELIGIBLE')
      expect(reason(answer.unanchored)).toBe('org-role-unanchored')
    } finally {
      await db.dispose()
    }
  })

  it('exempts the canonical administrator from eligibility, and nothing else', async () => {
    // from rbac.test.ts 'exempts only the canonical administrator'. The
    // exemption is recognised by the whole shape, not by "has a system key",
    // which would exempt every system role added later.
    const db = await createTestContext('effect-parity-exemption')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const actor = as(f.a.tenantId, f.a.admin)
          const nobody = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.a.tenantId}, 'Nobody', ${f.a.locked}, ${f.a.root}) returning id`),
          ).id
          // a second system role, which declares no eligible types
          const other = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
              values (${f.a.tenantId}, 'other-system', 'Other', 'tenant', 'active', 'explicit',
                'something-else')
              returning id`),
          ).id
          return {
            // the canonical administrator may be handed to anyone
            canonical: yield* Effect.result(
              access.grants.grant(
                f.a.tenantId,
                { userId: nobody, roleId: f.a.adminRole, target: { kind: 'tenant' } },
                actor,
              ),
            ),
            // another system role inherits nothing from that
            other: yield* Effect.result(
              access.grants.grant(
                f.a.tenantId,
                { userId: nobody, roleId: other, target: { kind: 'tenant' } },
                actor,
              ),
            ),
          }
        }),
      )
      const answer = ok(exit)
      expect(tagOf(answer.canonical)).toBeUndefined()
      expect(tagOf(answer.other)).toBe('GRANT_NOT_ELIGIBLE')
    } finally {
      await db.dispose()
    }
  })

  it('counts an administrator who could still sign in, not merely a holder', async () => {
    // from rbac.test.ts of the same name. A holder whose account, type or
    // login channels are gone is not a way back into the tenant, so the
    // invariant has to look past the grant.
    const db = await createTestContext('effect-parity-survivors')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const rbac = yield* Rbac
          const survives = () =>
            Effect.result(rbac.assertTenantKeepsAdministrator(f.a.tenantId)).pipe(
              Effect.map((result) => tagOf(result) ?? 'ok'),
            )
          const start = yield* survives()
          const cases: Record<string, string> = {}
          for (const [label, disable, restore] of [
            [
              'user disabled',
              sql`update users set enabled = false where id = ${f.a.admin}`,
              sql`update users set enabled = true where id = ${f.a.admin}`,
            ],
            [
              'type disabled',
              sql`update user_types set enabled = false where id = ${f.a.staff}`,
              sql`update user_types set enabled = true where id = ${f.a.staff}`,
            ],
            [
              'no login channel',
              sql`update user_types set allow_local_login = false, allow_sso_login = false
                  where id = ${f.a.staff}`,
              sql`update user_types set allow_local_login = true where id = ${f.a.staff}`,
            ],
          ] as const) {
            yield* runSql(disable)
            cases[label] = yield* survives()
            yield* runSql(restore)
          }
          return { start, cases, end: yield* survives() }
        }),
      )
      const answer = ok(exit)
      expect(answer.start).toBe('ok')
      expect(answer.cases).toEqual({
        'user disabled': 'LAST_ADMINISTRATOR',
        'type disabled': 'LAST_ADMINISTRATOR',
        // a type nobody can sign in with is a holder who cannot come back
        'no login channel': 'LAST_ADMINISTRATOR',
      })
      expect(answer.end).toBe('ok')
    } finally {
      await db.dispose()
    }
  })

  it('lets exactly one of two concurrent administrator revocations win', async () => {
    // from rbac.test.ts 'serializes concurrent administrator revocations'. The
    // tenant lock is what forces the second transaction to see the first
    // delete rather than both reading two survivors and both committing.
    const db = await createTestContext('effect-parity-race')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const rbac = yield* Rbac
          const actor = as(f.a.tenantId, f.a.admin)
          // a second administrator, so there are two grants to race over
          const second = yield* access.grants.grant(
            f.a.tenantId,
            { userId: f.a.manager, roleId: f.a.adminRole, target: { kind: 'tenant' } },
            actor,
          )
          const first = one<{ id: string }>(
            yield* runSql(sql`
              select id from role_grants
              where tenant_id = ${f.a.tenantId} and role_id = ${f.a.adminRole}
                and user_id = ${f.a.admin}`),
          ).id
          // each revokes the OTHER's grant: one's own is refused before the
          // race even starts, so racing over it would test the wrong rule
          const revoke = (grantId: string, by: string) =>
            Effect.result(
              access.grants.revoke(f.a.tenantId, grantId, as(f.a.tenantId, by), (tenantId) =>
                rbac.assertTenantKeepsAdministrator(tenantId),
              ),
            )
          const [a, b] = yield* Effect.all(
            [revoke(first, f.a.manager), revoke(second, f.a.admin)],
            { concurrency: 2 },
          )
          const left = one<{ count: number }>(
            yield* runSql(sql`
              select count(*)::int as count from role_grants
              where tenant_id = ${f.a.tenantId} and role_id = ${f.a.adminRole}`),
          ).count
          return { tags: [tagOf(a), tagOf(b)], left }
        }),
      )
      const answer = ok(exit)
      // Exactly one committed. Which failure the other gets depends on the
      // order they serialize in: losing one's admin grant first leaves no
      // authority (or no admin standing) to revoke with, and going second
      // trips the invariant. All are correct refusals, and pinning one would
      // pin the interleaving instead of the guarantee.
      const refused = answer.tags.filter((tag) => tag !== undefined)
      expect(refused).toHaveLength(1)
      expect(['LAST_ADMINISTRATOR', 'ACCESS_DENIED', 'TENANT_ADMIN_REQUIRED']).toContain(refused[0])
      // and the tenant still has a way back in, which is what all of it is for
      expect(answer.left).toBe(1)
    } finally {
      await db.dispose()
    }
  })

  it('pushes the authorized scope into the read rather than filtering afterwards', async () => {
    // from rbac.test.ts 'pushes the authorized scope into the query'. A self
    // anchor and a subtree anchor have to give visibly different answers, and
    // an anchor outside the caller's reach has to be absent rather than
    // present-and-unmanageable.
    const db = await createTestContext('effect-parity-scope')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const rbac = yield* Rbac
          const grandchild = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.a.tenantId}, ${f.a.child}, ${f.a.orgType}, 'Deep', 'r.c.d', 2)
              returning id`),
          ).id
          const readPermission = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('iam.grant.read', 'iam', 'read grants', 'org-node')
              on conflict (code) do update set code = excluded.code returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.a.tenantId}, ${f.a.managerRole}, ${readPermission})`)
          const manager = as(f.a.tenantId, f.a.manager)
          const subtree = yield* rbac.listAuthorizedScope(manager, 'iam.grant.read')
          // narrow the same grant to self and ask again
          yield* runSql(sql`
            update role_grants set coverage = 'self'
            where tenant_id = ${f.a.tenantId} and role_id = ${f.a.managerRole}`)
          const self = yield* rbac.listAuthorizedScope(manager, 'iam.grant.read')
          return {
            subtree,
            self,
            reachesDeepWithSubtree: yield* rbac.canAt(manager, 'org.tree.manage', grandchild),
          }
        }),
      )
      const answer = ok(exit)
      // the anchor is the same node either way; the coverage is what differs,
      // and a consumer that read only the anchors could not tell them apart
      expect(answer.subtree.anchors).toEqual([
        { orgNodeId: expect.any(String), coverage: 'subtree' },
      ])
      expect(answer.self.anchors).toEqual([{ orgNodeId: expect.any(String), coverage: 'self' }])
      expect(answer.subtree.tenantWide).toBe(false)
      // the self narrowing happened after this was read, so the subtree grant
      // is what answered: a descendant is inside it
      expect(answer.reachesDeepWithSubtree).toBe(false)
    } finally {
      await db.dispose()
    }
  })
})
