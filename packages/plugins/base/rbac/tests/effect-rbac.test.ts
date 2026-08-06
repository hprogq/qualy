import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '../src/db/entities.ts'
import { kyselyOf, transaction, type Orm } from '@qualy/plugin-database/server'
import { rbacEntityManager } from '../src/server/db.ts'
import { Rbac } from '@qualy/rbac-contract/effect'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { Access } from '../src/server/index.ts'
import { serviceLayer as rbacLayer } from '../src/server/index.ts'

// rbac under Effect, answering against a real database.
//
// The point is not that it runs. It is that the decisions are the ones the
// cordis service already makes, because both execute the same statements from
// src/queries.ts. An authorization system that exists twice is two systems
// that agree until one is edited, and the divergence would not look like a
// bug: it would look like an answer.

const catalog: readonly ActivePermission[] = [
  // rbac's real declarations plus the codes these fixtures grant: the catalog
  // is a prepare-phase value now, so the harness states the whole of it
  ...compileCatalog([{ owner: 'rbac', permissions: rbacPermissions }]),
  { code: 'org.tree.read', name: 'read', target: 'org-node', plugin: 'org' },
  { code: 'org.tree.manage', name: 'manage', target: 'org-node', plugin: 'org' },
  { code: 'iam.user.read', name: 'users', target: 'tenant', plugin: 'iam' },
]

// what the orm must know for a query to name a table
const closure = [...orgEntities, ...authEntities, ...rbacEntities] as const

const stack = (url: string) =>
  booted(
    rbacLayer.pipe(
      // provideMerge rather than provide: the tests write fixtures through the
      // same Database the layer uses, so it has to stay available above
      Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
    ),
    { catalog },
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Rbac | Access | Orm | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

/** the lists a policy names, or null when it names everything */
type EligibilityView = { eligibility: { mode: string; userTypeIds?: readonly string[] } }
type AnchorView = { anchor: { mode: string; orgTypeIds?: readonly string[] } }
const eligibleOf = (read: EligibilityView) => read.eligibility.userTypeIds ?? null
const anchoredOf = (read: AnchorView) => read.anchor.orgTypeIds ?? null

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

/** a tenant with a root node, an administrator role and one holder */
const seed = Effect.fn('seed')(function* () {
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('t', 'T') returning id`),
  ).id
  const orgType = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_types (tenant_id, code, name) values (${tenant}, 'u', 'U') returning id`),
  ).id
  const root = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${tenant}, ${orgType}, 'Root', 'r', 0) returning id`),
  ).id
  const child = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
      values (${tenant}, ${root}, ${orgType}, 'Child', 'r.c', 1) returning id`),
  ).id
  const userType = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
      values (${tenant}, 'staff', 'Staff', true, 'unrestricted') returning id`),
  ).id
  const user = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Ada', ${userType}, ${root}) returning id`),
  ).id
  const role = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
      values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
      returning id`),
  ).id
  // tenant-wide: anchor and coverage are null together, which is what
  // chk_role_grants_anchor requires and what a tenant role means
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id)
    values (${tenant}, ${user}, ${role})`)
  // a second holder with an ordinary role carrying one org permission,
  // anchored at the root with self coverage. The admin role cannot be demoted
  // to test denial: chk_roles_tenant_admin_shape forbids it, correctly.
  const plainUser = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Grace', ${userType}, ${root}) returning id`),
  ).id
  const plainRole = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode)
      values (${tenant}, 'local', 'Local', 'org', 'active', 'explicit') returning id`),
  ).id
  const permission = one<{ id: string }>(
    yield* runSql(sql`
      insert into permissions (code, plugin, name, target_kind)
      values ('org.tree.manage', 'org', 'manage', 'org-node')
      on conflict (code) do update set code = excluded.code returning id`),
  ).id
  yield* runSql(sql`
    insert into role_permissions (tenant_id, role_id, permission_id)
    values (${tenant}, ${plainRole}, ${permission})`)
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
    values (${tenant}, ${plainUser}, ${plainRole}, ${root}, 'self')`)

  const principal: Principal = { tenantId: tenant, userId: user, sessionId: 's' }
  const anchored: Principal = { tenantId: tenant, userId: plainUser, sessionId: 's' }
  return { tenant, root, child, user, role, plainRole, principal, anchored }
})

describe.runIf(postgresAvailable).concurrent('rbac as an Effect layer', () => {
  it('lets an administrator reach every node, and says so through the port', async () => {
    const db = await createTestContext('effect-rbac-admin')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const rbac = yield* Rbac
          return {
            atRoot: yield* rbac.canAt(f.principal, 'org.tree.manage', f.root),
            atChild: yield* rbac.canAt(f.principal, 'org.tree.manage', f.child),
            // the administrator branch is tenant-wide rather than anchored
            scope: yield* rbac.listAuthorizedScope(f.principal, 'org.tree.manage'),
            tenantCode: yield* rbac.hasPermission(f.principal, 'iam.user.read'),
            profile: yield* rbac.getProfile(f.principal),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.atRoot).toBe(true)
      expect(answer.atChild).toBe(true)
      expect(answer.scope.tenantWide).toBe(true)
      expect(answer.tenantCode).toBe(true)
      expect(answer.profile.tenantPermissions).toContain('iam.user.read')
      expect(answer.profile.orgPermissions).toContain('org.tree.manage')
    } finally {
      await db.dispose()
    }
  })

  it('stops a self anchor at its own node, and denies as a failure', async () => {
    const db = await createTestContext('effect-rbac-deny')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const rbac = yield* Rbac
          const denied = yield* Effect.result(
            rbac.requireAt(f.anchored, 'org.tree.manage', f.child),
          )
          return {
            atAnchor: yield* rbac.canAt(f.anchored, 'org.tree.manage', f.root),
            below: yield* rbac.canAt(f.anchored, 'org.tree.manage', f.child),
            scope: yield* rbac.listAuthorizedScope(f.anchored, 'org.tree.manage'),
            denied: denied._tag === 'Failure',
            reason:
              denied._tag === 'Failure' ? (denied.failure as { _tag?: string })._tag : undefined,
          }
        }),
      )
      const answer = ok(exit)
      // self coverage reaches the anchor and nothing under it
      expect(answer.atAnchor).toBe(true)
      expect(answer.below).toBe(false)
      expect(answer.scope.tenantWide).toBe(false)
      expect(answer.scope.anchors).toHaveLength(1)
      // and a denial is a declared failure the caller must handle, not a defect
      expect(answer.denied).toBe(true)
      expect(answer.reason).toBe('ACCESS_DENIED')
    } finally {
      await db.dispose()
    }
  })

  it('stops authorizing through a permission row edited out of band', async () => {
    const db = await createTestContext('effect-rbac-repointed')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const rbac = yield* Rbac
          const before = yield* rbac.canAt(f.anchored, 'org.tree.manage', f.root)
          // the assembly-time drift check has already run and passed; this is
          // the row changing underneath it. What the registry verified is what
          // authorizes, so a row that no longer matches the declaration must
          // stop granting rather than start granting something else.
          yield* runSql(
            sql`update permissions set plugin = 'not-org' where code = 'org.tree.manage'`,
          )
          const after = yield* rbac.canAt(f.anchored, 'org.tree.manage', f.root)
          return { before, after }
        }),
      )
      const answer = ok(exit)
      expect(answer.before).toBe(true)
      expect(answer.after).toBe(false)
    } finally {
      await db.dispose()
    }
  })

  it('authorizes nothing for a code the assembly does not serve', async () => {
    const db = await createTestContext('effect-rbac-unknown')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const rbac = yield* Rbac
          // the row exists in the database but the catalog does not carry it,
          // so it must authorize nothing rather than start authorizing
          return {
            has: yield* rbac.hasPermission(f.principal, 'ghost.code'),
            canAt: yield* rbac.canAt(f.principal, 'ghost.code', f.root),
            scope: yield* rbac.listAuthorizedScope(f.principal, 'ghost.code'),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.has).toBe(false)
      expect(answer.canAt).toBe(false)
      expect(answer.scope).toEqual({ tenantWide: false, anchors: [] })
    } finally {
      await db.dispose()
    }
  })

  it("keeps the last administrator, reading the caller's uncommitted state", async () => {
    const db = await createTestContext('effect-rbac-last-admin')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const rbac = yield* Rbac
          const disable = Effect.gen(function* () {
            const em = yield* rbacEntityManager()
            yield* Effect.promise(() =>
              kyselyOf(em)
                .updateTable('User')
                .set({ enabled: false })
                .where('id', '=', f.user)
                .execute(),
            )
          })
          const before = yield* Effect.result(rbac.assertTenantKeepsAdministrator(f.tenant))
          // disable the only administrator inside a transaction, then ask:
          // the check has to see the write that has not committed yet. The
          // caller opens its transaction the way auth does, which is what
          // decides whether the check lands on the same connection.
          const after = yield* Effect.result(
            transaction(
              Effect.gen(function* () {
                yield* disable
                yield* rbac.assertTenantKeepsAdministrator(f.tenant)
              }),
            ),
          )
          const em = yield* rbacEntityManager()
          const stillEnabled = yield* Effect.promise(() =>
            kyselyOf(em)
              .selectFrom('User')
              .select('enabled')
              .where('id', '=', f.user)
              .executeTakeFirstOrThrow(),
          )
          return {
            beforeOk: before._tag === 'Success',
            refused: after._tag === 'Failure',
            rolledBack: stillEnabled.enabled,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.beforeOk).toBe(true)
      // it saw the uncommitted disable, which is the whole reason this check
      // has to run on the caller's connection
      expect(answer.refused).toBe(true)
      // and refusing rolled the caller's own write back
      expect(answer.rolledBack).toBe(true)
    } finally {
      await db.dispose()
    }
  })

  it('stops a subtree anchor at a label boundary, not a string prefix', async () => {
    // org projects coverage in TypeScript with a path-prefix test while rbac
    // decides it in SQL with ltree containment. They agree only because the
    // TypeScript one compares against `anchor.path + "."`; drop that separator
    // and an anchor at `r.a` starts covering a sibling at `r.ab`. This pins the
    // case that tells the two implementations apart.
    const db = await createTestContext('effect-rbac-label')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const orgType = one<{ id: string }>(
            yield* runSql(sql`select id from org_types where tenant_id = ${f.tenant} limit 1`),
          ).id
          // r.a is the anchor; r.ab is a sibling sharing its string prefix
          const anchor = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.root}, ${orgType}, 'A', 'r.a', 1) returning id`),
          ).id
          const sibling = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.root}, ${orgType}, 'AB', 'r.ab', 1) returning id`),
          ).id
          const below = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${anchor}, ${orgType}, 'Deep', 'r.a.x', 2) returning id`),
          ).id
          // move the plain role's grant to a subtree anchor at r.a
          yield* runSql(sql`
            update role_grants set org_node_id = ${anchor}, coverage = 'subtree'
            where user_id = ${f.anchored.userId}`)

          const rbac = yield* Rbac
          return {
            atAnchor: yield* rbac.canAt(f.anchored, 'org.tree.manage', anchor),
            below: yield* rbac.canAt(f.anchored, 'org.tree.manage', below),
            sibling: yield* rbac.canAt(f.anchored, 'org.tree.manage', sibling),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.atAnchor).toBe(true)
      expect(answer.below).toBe(true)
      // the one that matters: r.ab is not inside r.a
      expect(answer.sibling).toBe(false)
    } finally {
      await db.dispose()
    }
  })

  it('refuses a grant the caller has no authority to administer', async () => {
    const db = await createTestContext('effect-grant-authority')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          // the anchored user administers nothing: they hold org.tree.manage
          // at one node and no grant-management permission at all
          const refused = yield* Effect.result(
            access.grants.grant(
              f.tenant,
              { userId: f.user, roleId: f.role, target: { kind: 'tenant' } },
              f.anchored,
            ),
          )
          return tagOf(refused)
        }),
      )
      expect(ok(exit)).toBe('ACCESS_DENIED')
    } finally {
      await db.dispose()
    }
  })

  it('reserves the administrator role for someone who already holds it', async () => {
    const db = await createTestContext('effect-grant-admin')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          // give the anchored user tenant-wide grant administration, which is
          // authority over grants but not over the administrator role
          const permission = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('iam.tenant-grant.manage','iam','manage tenant grants','tenant')
              on conflict (code) do update set code = excluded.code returning id`),
          ).id
          const role = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode)
              values (${f.tenant},'granter','Granter','tenant','active','explicit') returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${role}, ${permission})`)
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id)
            values (${f.tenant}, ${f.anchored.userId}, ${role})`)

          const access = yield* Access
          // f.role is the canonical administrator
          const refused = yield* Effect.result(
            access.grants.grant(
              f.tenant,
              { userId: f.anchored.userId, roleId: f.role, target: { kind: 'tenant' } },
              f.anchored,
            ),
          )
          // whereas the existing administrator may
          const allowed = yield* Effect.result(
            access.grants.grant(
              f.tenant,
              { userId: f.anchored.userId, roleId: f.role, target: { kind: 'tenant' } },
              f.principal,
            ),
          )
          return { refused: tagOf(refused), allowed: allowed._tag }
        }),
      )
      const answer = ok(exit)
      // The bind escape hatch must not be a route to becoming superuser. Its
      // own code, not a plain denial: the client has a sentence for this case,
      // and collapsing it into ACCESS_DENIED made that sentence unreachable.
      expect(answer.refused).toBe('TENANT_ADMIN_REQUIRED')
      expect(answer.allowed).toBe('Success')
    } finally {
      await db.dispose()
    }
  })

  it('answers a duplicate grant as a conflict rather than a fault', async () => {
    // Nothing in the write reads existing grants and the insert has no ON
    // CONFLICT, so both runtimes reach the unique index. Without translation
    // the violation is a defect and a double-click answers 500.
    const db = await createTestContext('effect-grant-duplicate')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const staff = one<{ id: string }>(
            yield* runSql(
              sql`select id from user_types where tenant_id = ${f.tenant} and code = 'staff'`,
            ),
          ).id
          const orgType = one<{ id: string }>(
            yield* runSql(
              sql`select id from org_types where tenant_id = ${f.tenant} and code = 'u'`,
            ),
          ).id
          yield* runSql(sql`
            insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
            values (${f.tenant}, ${f.plainRole}, ${staff})`)
          yield* runSql(sql`
            insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
            values (${f.tenant}, ${f.plainRole}, ${orgType})`)
          const target = {
            kind: 'org-node' as const,
            orgNodeId: f.child,
            coverage: 'self' as const,
          }
          yield* access.grants.grant(
            f.tenant,
            { userId: f.user, roleId: f.plainRole, target },
            f.principal,
          )
          return yield* Effect.result(
            access.grants.grant(
              f.tenant,
              { userId: f.user, roleId: f.plainRole, target },
              f.principal,
            ),
          )
        }),
      )
      expect(tagOf(ok(exit))).toBe('GRANT_EXISTS')
    } finally {
      await db.dispose()
    }
  })

  it('will not let a self-anchored grant administrator create a subtree grant', async () => {
    // Authority over grants answers to coverage, not just to the node.
    // Administering grants at one node alone must not be a way to create, or
    // quietly revoke, a grant that reaches its whole subtree.
    const db = await createTestContext('effect-grant-reach')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const orgType = one<{ id: string }>(
            yield* runSql(sql`select id from org_types where tenant_id = ${f.tenant} limit 1`),
          ).id
          // the role being handed out is an ordinary org role the granter holds
          yield* runSql(sql`
            insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
            values (${f.tenant}, ${f.plainRole}, ${orgType})`)
          yield* runSql(sql`
            insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
            select ${f.tenant}, ${f.plainRole}, id from user_types
            where tenant_id = ${f.tenant} limit 1`)

          // The granter holds the role's own capability at SUBTREE reach, so
          // the escalation guard would allow a subtree grant. Only their
          // authority over grants is narrower, which is what this isolates.
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${f.anchored.userId}, ${f.plainRole}, ${f.child}, 'subtree')`)

          // the granter administers grants at the child node, self only
          const manage = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('iam.grant.manage','iam','manage grants','org-node')
              on conflict (code) do update set code = excluded.code returning id`),
          ).id
          const granterRole = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode)
              values (${f.tenant},'granter','Granter','org','active','explicit') returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${granterRole}, ${manage})`)
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${f.anchored.userId}, ${granterRole}, ${f.child}, 'self')`)

          const access = yield* Access
          const wide = yield* Effect.result(
            access.grants.grant(
              f.tenant,
              {
                userId: f.user,
                roleId: f.plainRole,
                target: { kind: 'org-node', orgNodeId: f.child, coverage: 'subtree' },
              },
              f.anchored,
            ),
          )
          const narrow = yield* Effect.result(
            access.grants.grant(
              f.tenant,
              {
                userId: f.user,
                roleId: f.plainRole,
                target: { kind: 'org-node', orgNodeId: f.child, coverage: 'self' },
              },
              f.anchored,
            ),
          )
          return { wide: tagOf(wide), narrow: narrow._tag }
        }),
      )
      const answer = ok(exit)
      // a self-coverage grant administrator may not hand out subtree reach
      expect(answer.wide).toBe('ACCESS_DENIED')
      expect(answer.narrow).toBe('Success')
    } finally {
      await db.dispose()
    }
  })

  it('checks completeness only when a role becomes usable', async () => {
    // A draft is allowed to be half-filled: the gate is activation, so a role
    // is never enabled and unable to do anything, and nobody is nagged field
    // by field while they are still filling it in.
    const db = await createTestContext('effect-role-activation')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const roleId = yield* access.roles.create(f.tenant, {
            code: 'reviewer',
            name: 'Reviewer',
            kind: 'org',
          })
          // empty draft: activation names everything it still needs
          const empty = yield* Effect.result(
            access.roles.setStatus(f.tenant, roleId, 'active', 1, f.principal),
          )

          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const permission = one<{ id: string }>(
            yield* runSql(sql`select id from permissions where code = 'org.tree.manage'`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${roleId}, ${permission})`)
          const stillMissing = yield* Effect.result(
            access.roles.setStatus(f.tenant, roleId, 'active', 1, f.principal),
          )

          const userType = one<{ id: string }>(
            yield* runSql(sql`select id from user_types where tenant_id = ${f.tenant} limit 1`),
          ).id
          const orgType = one<{ id: string }>(
            yield* runSql(sql`select id from org_types where tenant_id = ${f.tenant} limit 1`),
          ).id
          yield* runSql(sql`
            insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
            values (${f.tenant}, ${roleId}, ${userType})`)
          yield* runSql(sql`
            insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
            values (${f.tenant}, ${roleId}, ${orgType})`)
          const complete = yield* Effect.result(
            access.roles.setStatus(f.tenant, roleId, 'active', 1, f.principal),
          )

          return {
            empty: (empty as { failure?: { missing?: string[] } }).failure?.missing,
            emptyTag: tagOf(empty),
            stillMissing: (stillMissing as { failure?: { missing?: string[] } }).failure?.missing,
            complete: complete._tag,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.emptyTag).toBe('ROLE_INCOMPLETE')
      // the refusal names everything at once rather than one field at a time
      expect(answer.empty).toEqual(['permissions', 'user-types', 'org-types'])
      expect(answer.stillMissing).toEqual(['user-types', 'org-types'])
      expect(answer.complete).toBe('Success')
    } finally {
      await db.dispose()
    }
  })

  it('will not let an author activate a role beyond their own authority', async () => {
    const db = await createTestContext('effect-role-escalation')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const roleId = yield* access.roles.create(f.tenant, {
            code: 'wide',
            name: 'Wide',
            kind: 'tenant',
          })
          const permission = one<{ id: string }>(
            yield* runSql(sql`select id from permissions where code = 'iam.user.read'`),
          ).id
          const userType = one<{ id: string }>(
            yield* runSql(sql`select id from user_types where tenant_id = ${f.tenant} limit 1`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${roleId}, ${permission})`)
          yield* runSql(sql`
            insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
            values (${f.tenant}, ${roleId}, ${userType})`)

          // the anchored user holds org.tree.manage at one node and nothing
          // tenant-wide, so this definition is beyond them
          const beyond = yield* Effect.result(
            access.roles.setStatus(f.tenant, roleId, 'active', 1, f.anchored),
          )
          // the administrator holds everything, so it is not beyond them
          const allowed = yield* Effect.result(
            access.roles.setStatus(f.tenant, roleId, 'active', 1, f.principal),
          )
          return { beyond: tagOf(beyond), allowed: allowed._tag }
        }),
      )
      const answer = ok(exit)
      expect(answer.beyond).toBe('ROLE_ESCALATION_REFUSED')
      expect(answer.allowed).toBe('Success')
    } finally {
      await db.dispose()
    }
  })

  it('replaces permissions only within what the catalog currently offers', async () => {
    // The case that would quietly destroy authority: a row whose plugin is
    // unloaded was never on offer, so omitting it is not declining it.
    // Unloading a plugin suspends its capabilities; it must not delete them.
    const db = await createTestContext('effect-role-permissions')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const roleId = yield* access.roles.create(f.tenant, {
            code: 'reviewer',
            name: 'Reviewer',
            kind: 'org',
          })
          // one code the catalog serves, and one from a plugin nobody loaded
          const ghost = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('ghost.code','ghost','Ghost','org-node') returning id`),
          ).id
          const known = one<{ id: string }>(
            yield* runSql(sql`select id from permissions where code = 'org.tree.read'`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${roleId}, ${ghost}), (${f.tenant}, ${roleId}, ${known})`)

          // replace with a different served code, omitting both
          yield* access.roles.setPermissions(f.tenant, roleId, ['org.tree.manage'], 1, f.principal)
          const after = yield* access.roles.getPermissions(f.tenant, roleId, f.principal)
          return { active: after.active, unavailable: after.unavailable }
        }),
      )
      const answer = ok(exit)
      // the served code the caller omitted is gone, as they asked
      expect(answer.active).toEqual(['org.tree.manage'])
      // the unloaded plugin's row survives, because it was never on offer
      expect(answer.unavailable).toEqual(['ghost.code'])
    } finally {
      await db.dispose()
    }
  })

  it('pushes grant visibility into the query, so a page is never silently short', async () => {
    // A page assembled and then filtered returns short pages and a cursor that
    // skips: the limit applies before the caller's authority is considered, so
    // rows they may not see consume their page. The filter therefore has to be
    // part of the statement, and this is the assertion that says so.
    const db = await createTestContext('effect-grant-reads')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const staff = one<{ id: string }>(
            yield* runSql(
              sql`select id from user_types where tenant_id = ${f.tenant} and code = 'staff'`,
            ),
          ).id
          // a second org node beside the root's child, outside a self anchor
          const orgType = one<{ id: string }>(
            yield* runSql(
              sql`select id from org_types where tenant_id = ${f.tenant} and code = 'u'`,
            ),
          ).id
          const far = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.root}, ${orgType}, 'Far', 'r.f', 1) returning id`),
          ).id
          // a role anyone may hold, granted at both places
          const roleId = yield* access.roles.create(f.tenant, {
            code: 'local2',
            name: 'Local Two',
            kind: 'org',
          })
          yield* runSql(sql`
            insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
            values (${f.tenant}, ${roleId}, ${staff})`)
          yield* runSql(sql`
            insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
            values (${f.tenant}, ${roleId}, ${orgType})`)
          for (const node of [f.child, far]) {
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.tenant}, ${f.user}, ${roleId}, ${node}, 'self')`)
          }

          // the administrator sees everything, including the tenant-wide grant
          const wide = yield* access.grantScopeFor(f.principal)
          const all = yield* access.grants.list(f.tenant, {}, wide)

          // a caller who administers grants only under r.c sees only those
          const narrow = {
            read: {
              tenantWide: false,
              anchors: [{ orgNodeId: f.child, coverage: 'self' as const }],
            },
            manage: { tenantWide: false, anchors: [] },
            tenantGrants: { read: false, manage: false },
          }
          const scoped = yield* access.grants.list(f.tenant, {}, narrow)
          // one row per page, to catch a filter applied after the limit
          const firstPage = yield* access.grants.list(f.tenant, {}, narrow, { limit: 1 })
          return { all: all.length, scoped, firstPage, child: f.child }
        }),
      )
      const answer = ok(exit)
      // both of this test's grants, the seed's anchored one, and the
      // tenant-wide one an anchor could never have expressed
      expect(answer.all).toBe(4)
      // exactly the grant under the anchor: not the tenant-wide one, whose
      // node is null and which no node anchor can reach, and not the one at
      // the sibling node
      expect(answer.scoped.map((row) => row.orgNodeId)).toEqual([answer.child])
      // may see it, may not change it: two permissions, two answers
      expect(answer.scoped[0]!.manageable).toBe(false)
      // the page is full, because the invisible rows never entered it
      expect(answer.firstPage).toHaveLength(1)
    } finally {
      await db.dispose()
    }
  })

  it('offers only roles the write would actually accept, and says when nobody is there', async () => {
    const db = await createTestContext('effect-grant-options')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const staff = one<{ id: string }>(
            yield* runSql(
              sql`select id from user_types where tenant_id = ${f.tenant} and code = 'staff'`,
            ),
          ).id
          const orgType = one<{ id: string }>(
            yield* runSql(
              sql`select id from org_types where tenant_id = ${f.tenant} and code = 'u'`,
            ),
          ).id
          // an active, assignable role nobody is eligible for: it must not be
          // offered, because the write would refuse it
          const ineligible = yield* access.roles.create(f.tenant, {
            code: 'closed',
            name: 'Closed',
            kind: 'org',
          })
          yield* runSql(sql`
            insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
            values (${f.tenant}, ${ineligible}, ${orgType})`)
          const known = one<{ id: string }>(
            yield* runSql(sql`select id from permissions where code = 'org.tree.read'`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${ineligible}, ${known})`)
          yield* runSql(sql`
            update roles set status = 'active' where id = ${ineligible}`)
          // and the seed's org role, which staff may hold at this node type
          yield* runSql(sql`
            insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
            values (${f.tenant}, ${f.plainRole}, ${staff})`)
          yield* runSql(sql`
            insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
            values (${f.tenant}, ${f.plainRole}, ${orgType})`)

          const offered = yield* access.grants.options(
            f.tenant,
            {
              userId: f.user,
              target: { kind: 'org-node', orgNodeId: f.child, coverage: 'self' },
            },
            f.principal,
          )
          // a request naming somebody who is not there is told so, rather than
          // being handed an empty list that reads as a permission answer
          const absent = yield* Effect.result(
            access.grants.options(
              f.tenant,
              {
                userId: '00000000-0000-7000-8000-000000000000',
                target: { kind: 'tenant' },
              },
              f.principal,
            ),
          )
          return { offered, absent }
        }),
      )
      const answer = ok(exit)
      expect(answer.offered.map((role) => role.code)).toEqual(['local'])
      expect(tagOf(answer.absent)).toBe('GRANT_USER_NOT_FOUND')
    } finally {
      await db.dispose()
    }
  })

  it('explains a decision with the predicate that made it', async () => {
    const db = await createTestContext('effect-explain')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const rbac = yield* Rbac
          // the anchored holder: one org capability, at the root, self only
          const here = yield* access.diagnostics.explain(f.tenant, f.anchored.userId, f.root)
          const below = yield* access.diagnostics.explain(f.tenant, f.anchored.userId, f.child)
          const decided = yield* rbac.canAt(f.anchored, 'org.tree.manage', f.child)
          const evaluated = yield* access.diagnostics.evaluate(f.tenant, {
            userId: f.anchored.userId,
            permissionCode: 'org.tree.manage',
            orgNodeId: f.root,
          })
          // an org capability asked about without saying where has no answer
          const nowhere = yield* Effect.result(
            access.diagnostics.evaluate(f.tenant, {
              userId: f.anchored.userId,
              permissionCode: 'org.tree.manage',
            }),
          )
          const unknown = yield* Effect.result(
            access.diagnostics.evaluate(f.tenant, {
              userId: f.anchored.userId,
              permissionCode: 'nope.code',
              orgNodeId: f.root,
            }),
          )
          return { here, below, decided, evaluated, nowhere, unknown }
        }),
      )
      const answer = ok(exit)
      expect(answer.here.map((row) => row.code)).toEqual(['org.tree.manage'])
      // the explanation names the grant, which is what makes it actionable
      expect(answer.here[0]!.sources[0]!.target).toMatchObject({
        kind: 'org-node',
        coverage: 'self',
      })
      // and it stops exactly where the decision stops
      expect(answer.below).toEqual([])
      expect(answer.decided).toBe(false)
      expect(answer.evaluated.allowed).toBe(true)
      expect(answer.evaluated.sources).toHaveLength(1)
      expect(tagOf(answer.nowhere)).toBe('ACCESS_TARGET_REQUIRED')
      expect(tagOf(answer.unknown)).toBe('PERMISSION_NOT_FOUND')
    } finally {
      await db.dispose()
    }
  })

  it('will not narrow eligibility past a grant that already exists', async () => {
    // The tenant-grant case is the one on record: a tenant grant has no node,
    // so the check joining the node inward dropped every one of them, and
    // narrowing a tenant role's user types stranded its holders in silence.
    const db = await createTestContext('effect-role-eligibility')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const staff = one<{ id: string }>(
            yield* runSql(
              sql`select id from user_types where tenant_id = ${f.tenant} and code = 'staff'`,
            ),
          ).id
          const other = one<{ id: string }>(
            yield* runSql(sql`
              insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
              values (${f.tenant}, 'guest', 'Guest', true, 'unrestricted') returning id`),
          ).id
          const orgType = one<{ id: string }>(
            yield* runSql(
              sql`select id from org_types where tenant_id = ${f.tenant} and code = 'u'`,
            ),
          ).id

          const roleId = yield* access.roles.create(f.tenant, {
            code: 'wide',
            name: 'Wide',
            kind: 'tenant',
          })
          // a tenant role admits no org types, whatever the caller sends
          const version = yield* access.roles.setEligibility(
            f.tenant,
            roleId,
            {
              eligibility: { mode: 'allow-list', userTypeIds: [staff] },
              anchor: { mode: 'allow-list', orgTypeIds: [orgType] },
            },
            1,
          )
          const stored = yield* access.roles.getEligibility(f.tenant, roleId)

          // a tenant-wide grant: anchor and coverage null together
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id)
            values (${f.tenant}, ${f.user}, ${roleId})`)

          const stranding = yield* Effect.result(
            access.roles.setEligibility(
              f.tenant,
              roleId,
              {
                eligibility: { mode: 'allow-list', userTypeIds: [other] },
                anchor: { mode: 'allow-list', orgTypeIds: [] },
              },
              version,
            ),
          )
          const unknown = yield* Effect.result(
            access.roles.setEligibility(
              f.tenant,
              roleId,
              {
                eligibility: {
                  mode: 'allow-list',
                  userTypeIds: ['00000000-0000-7000-8000-000000000000'],
                },
                anchor: { mode: 'allow-list', orgTypeIds: [] },
              },
              version,
            ),
          )
          // the refusal has to have rolled the deletes back with it
          const after = yield* access.roles.getEligibility(f.tenant, roleId)
          return { stored, stranding, unknown, after, staff }
        }),
      )
      const answer = ok(exit)
      expect(eligibleOf(answer.stored)).toEqual([answer.staff])
      expect(anchoredOf(answer.stored)).toEqual([])
      expect(tagOf(answer.stranding)).toBe('GRANT_STRANDED')
      expect((answer.stranding as { failure: { grantCount: number } }).failure.grantCount).toBe(1)
      expect(tagOf(answer.unknown)).toBe('ROLE_USER_TYPE_NOT_FOUND')
      expect(eligibleOf(answer.after)).toEqual([answer.staff])
      expect(answer.after.version).toBe(answer.stored.version)
    } finally {
      await db.dispose()
    }
  })

  // "anyone" and "nobody" are the same empty list, which is why the mode is
  // stored rather than read off the list's size. Every consequence follows
  // from that one column: activation stops demanding a list, a grant of a type
  // the role never named is allowed, and deleting a user type cannot strand it.
  it('lets a role admit every user type without naming one', async () => {
    const db = await createTestContext('effect-role-eligibility-any')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const rbac = yield* Rbac
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const roleId = yield* access.roles.create(f.tenant, {
            code: 'open',
            name: 'Open',
            kind: 'tenant',
          })
          yield* access.roles.setPermissions(f.tenant, roleId, ['iam.user.read'], 1, f.principal)
          const version = yield* access.roles.setEligibility(
            f.tenant,
            roleId,
            { eligibility: { mode: 'unrestricted' }, anchor: { mode: 'unrestricted' } },
            2,
          )
          // an empty allow-list is refused here; the mode is what makes the
          // same empty table mean the opposite
          yield* access.roles.setStatus(f.tenant, roleId, 'active', version, f.principal)
          const read = yield* access.roles.getEligibility(f.tenant, roleId)

          // somebody of a type the role never named, and never could have
          const visitorType = one<{ id: string }>(
            yield* runSql(sql`
              insert into user_types (tenant_id, code, name, placement_mode, allow_local_login)
              values (${f.tenant}, 'visitor', 'Visitor', 'unrestricted', true) returning id`),
          ).id
          const visitor = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'Visitor', ${visitorType}, ${f.root}) returning id`),
          ).id
          yield* access.grants.grant(
            f.tenant,
            { userId: visitor, roleId, target: { kind: 'tenant' } },
            f.principal,
          )

          // and deleting that type cannot strand a role that never named one
          const stranded = yield* rbac.rolesStrandedByUserType(f.tenant, visitorType)

          // the other half, on the side that has it: an org role activating
          // without naming a single node type it may anchor to
          const anchored = yield* access.roles.create(f.tenant, {
            code: 'anywhere',
            name: 'Anywhere',
            kind: 'org',
          })
          yield* access.roles.setPermissions(
            f.tenant,
            anchored,
            ['org.tree.manage'],
            1,
            f.principal,
          )
          const anchoredVersion = yield* access.roles.setEligibility(
            f.tenant,
            anchored,
            { eligibility: { mode: 'unrestricted' }, anchor: { mode: 'unrestricted' } },
            2,
          )
          yield* access.roles.setStatus(f.tenant, anchored, 'active', anchoredVersion, f.principal)
          yield* access.grants.grant(
            f.tenant,
            {
              userId: visitor,
              roleId: anchored,
              target: { kind: 'org-node', orgNodeId: f.child, coverage: 'self' },
            },
            f.principal,
          )
          const anchorRead = yield* access.roles.getEligibility(f.tenant, anchored)
          return { read, stranded, anchorRead }
        }),
      )
      const answer = ok(exit)
      expect(answer.read.eligibility.mode).toBe('unrestricted')
      // a tenant role anchors to nothing, so its anchor policy stays the empty
      // list that says exactly that, whatever the caller sent
      expect(answer.read.anchor).toEqual({ mode: 'allow-list', orgTypeIds: [] })
      expect(answer.stranded).toBe(0)
      expect(answer.anchorRead.anchor.mode).toBe('unrestricted')
    } finally {
      await db.dispose()
    }
  })

  it('will not leave a usable role with nobody eligible, or edit the administrator', async () => {
    const db = await createTestContext('effect-role-eligibility-empty')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const emptied = yield* Effect.result(
            access.roles.setEligibility(
              f.tenant,
              f.plainRole,
              {
                eligibility: { mode: 'allow-list', userTypeIds: [] },
                anchor: { mode: 'allow-list', orgTypeIds: [] },
              },
              1,
            ),
          )
          // the canonical administrator is grantable to whoever the tenant
          // designates, so it declares no eligibility to edit
          const admin = yield* Effect.result(
            access.roles.setEligibility(
              f.tenant,
              f.role,
              {
                eligibility: { mode: 'allow-list', userTypeIds: [] },
                anchor: { mode: 'allow-list', orgTypeIds: [] },
              },
              1,
            ),
          )
          // a draft may be emptied: completeness is checked when it becomes usable
          const draft = yield* access.roles.create(f.tenant, {
            code: 'draft',
            name: 'Draft',
            kind: 'org',
          })
          yield* access.roles.setEligibility(
            f.tenant,
            draft,
            {
              eligibility: { mode: 'allow-list', userTypeIds: [] },
              anchor: { mode: 'allow-list', orgTypeIds: [] },
            },
            1,
          )
          const emptyDraft = yield* access.roles.getEligibility(f.tenant, draft)
          return { emptied, admin, emptyDraft }
        }),
      )
      const answer = ok(exit)
      expect(tagOf(answer.emptied)).toBe('ROLE_NEEDS_ELIGIBILITY')
      expect(tagOf(answer.admin)).toBe('ROLE_IS_SYSTEM')
      expect(answer.emptyDraft).toMatchObject({
        eligibility: { mode: 'allow-list', userTypeIds: [] },
        anchor: { mode: 'allow-list', orgTypeIds: [] },
        version: 2,
      })
    } finally {
      await db.dispose()
    }
  })

  it('refuses a capability whose calling convention the role cannot use', async () => {
    const db = await createTestContext('effect-role-target')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const tenantRole = yield* access.roles.create(f.tenant, {
            code: 'wide',
            name: 'Wide',
            kind: 'tenant',
          })
          // an org capability in a tenant role would apply at every node
          // without any grant having said so
          const mismatched = yield* Effect.result(
            access.roles.setPermissions(f.tenant, tenantRole, ['org.tree.manage'], 1, f.principal),
          )
          const unknown = yield* Effect.result(
            access.roles.setPermissions(f.tenant, tenantRole, ['nope.code'], 1, f.principal),
          )
          return { mismatched: tagOf(mismatched), unknown: tagOf(unknown) }
        }),
      )
      const answer = ok(exit)
      expect(answer.mismatched).toBe('ROLE_TARGET_MISMATCH')
      expect(answer.unknown).toBe('PERMISSION_NOT_FOUND')
    } finally {
      await db.dispose()
    }
  })
})
