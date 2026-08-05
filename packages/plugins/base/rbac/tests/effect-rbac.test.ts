import { sql } from 'drizzle-orm'
import { Effect, Exit, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import {
  DatabaseConfig,
  Database,
  layer as databaseLayer,
} from '@qualy/plugin-database/effect'
import { PermissionCatalog, Rbac } from '@qualy/rbac-contract/effect'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { Access, layer as rbacLayer } from '../src/effect/index.ts'

// rbac under Effect, answering against a real database.
//
// The point is not that it runs. It is that the decisions are the ones the
// cordis service already makes, because both execute the same statements from
// src/queries.ts. An authorization system that exists twice is two systems
// that agree until one is edited, and the divergence would not look like a
// bug: it would look like an answer.

const catalog: readonly ActivePermission[] = [
  { code: 'org.tree.read', name: 'read', target: 'org-node', plugin: 'org' },
  { code: 'org.tree.manage', name: 'manage', target: 'org-node', plugin: 'org' },
  { code: 'iam.user.read', name: 'users', target: 'tenant', plugin: 'iam' },
  // a code the catalog does not serve authorizes nothing, so the grant
  // administration permission has to be declared for anyone to hold it
  { code: 'iam.tenant-grant.manage', name: 'manage tenant grants', target: 'tenant', plugin: 'iam' },
  { code: 'iam.grant.manage', name: 'manage grants', target: 'org-node', plugin: 'iam' },
]

const stack = (url: string) =>
  rbacLayer.pipe(
    // provideMerge rather than provide: the tests write fixtures through the
    // same Database the layer uses, so it has to stay available above
    Layer.provideMerge(
      Layer.mergeAll(databaseLayer, Layer.succeed(PermissionCatalog, catalog)),
    ),
    Layer.provide(
      Layer.succeed(
        DatabaseConfig,
        DatabaseConfig.of({
          url: Redacted.make(url),
          migrations: 'apply',
          migrationsFolder: new URL('../../../../../db/migrations', import.meta.url).pathname,
        }),
      ),
    ),
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Rbac | Access | Database>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

/** a tenant with a root node, an administrator role and one holder */
const seed = Effect.fn('seed')(function* () {
  const db = yield* Database
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* db.execute(
      sql`insert into tenants (slug, name) values ('t', 'T') returning id`,
    ),
  ).id
  const orgType = one<{ id: string }>(
    yield* db.execute(sql`
      insert into org_types (tenant_id, code, name) values (${tenant}, 'u', 'U') returning id`),
  ).id
  const root = one<{ id: string }>(
    yield* db.execute(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${tenant}, ${orgType}, 'Root', 'r', 0) returning id`),
  ).id
  const child = one<{ id: string }>(
    yield* db.execute(sql`
      insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
      values (${tenant}, ${root}, ${orgType}, 'Child', 'r.c', 1) returning id`),
  ).id
  const userType = one<{ id: string }>(
    yield* db.execute(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
      values (${tenant}, 'staff', 'Staff', true, 'unrestricted') returning id`),
  ).id
  const user = one<{ id: string }>(
    yield* db.execute(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Ada', ${userType}, ${root}) returning id`),
  ).id
  const role = one<{ id: string }>(
    yield* db.execute(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
      values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
      returning id`),
  ).id
  // tenant-wide: anchor and coverage are null together, which is what
  // chk_role_grants_anchor requires and what a tenant role means
  yield* db.execute(sql`
    insert into role_grants (tenant_id, user_id, role_id)
    values (${tenant}, ${user}, ${role})`)
  // a second holder with an ordinary role carrying one org permission,
  // anchored at the root with self coverage. The admin role cannot be demoted
  // to test denial: chk_roles_tenant_admin_shape forbids it, correctly.
  const plainUser = one<{ id: string }>(
    yield* db.execute(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Grace', ${userType}, ${root}) returning id`),
  ).id
  const plainRole = one<{ id: string }>(
    yield* db.execute(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode)
      values (${tenant}, 'local', 'Local', 'org', 'active', 'explicit') returning id`),
  ).id
  const permission = one<{ id: string }>(
    yield* db.execute(sql`
      insert into permissions (code, plugin, name, target_kind)
      values ('org.tree.manage', 'org', 'manage', 'org-node')
      on conflict (code) do update set plugin = excluded.plugin returning id`),
  ).id
  yield* db.execute(sql`
    insert into role_permissions (tenant_id, role_id, permission_id)
    values (${tenant}, ${plainRole}, ${permission})`)
  yield* db.execute(sql`
    insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
    values (${tenant}, ${plainUser}, ${plainRole}, ${root}, 'self')`)

  const principal: Principal = { tenantId: tenant, userId: user, sessionId: 's' }
  const anchored: Principal = { tenantId: tenant, userId: plainUser, sessionId: 's' }
  return { tenant, root, child, user, role, plainRole, principal, anchored }
})

describe.runIf(postgresAvailable)('rbac as an Effect layer', () => {
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
              denied._tag === 'Failure'
                ? (denied.failure as { _tag?: string })._tag
                : undefined,
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
          const database = yield* Database
          const before = yield* Effect.result(rbac.assertTenantKeepsAdministrator(f.tenant))
          // disable the only administrator inside a transaction, then ask:
          // the check has to see the write that has not committed yet
          const after = yield* Effect.result(
            database.transaction((tx) =>
              Effect.gen(function* () {
                yield* tx.execute(sql`update users set enabled = false where id = ${f.user}`)
                yield* rbac.assertTenantKeepsAdministrator(f.tenant)
              }),
            ),
          )
          const stillEnabled = (yield* database.execute(
            sql`select enabled from users where id = ${f.user}`,
          )) as unknown as { rows: { enabled: boolean }[] }
          return {
            beforeOk: before._tag === 'Success',
            refused: after._tag === 'Failure',
            rolledBack: stillEnabled.rows[0]!.enabled,
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
          const database = yield* Database
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const orgType = one<{ id: string }>(
            yield* database.execute(
              sql`select id from org_types where tenant_id = ${f.tenant} limit 1`,
            ),
          ).id
          // r.a is the anchor; r.ab is a sibling sharing its string prefix
          const anchor = one<{ id: string }>(
            yield* database.execute(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.root}, ${orgType}, 'A', 'r.a', 1) returning id`),
          ).id
          const sibling = one<{ id: string }>(
            yield* database.execute(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.root}, ${orgType}, 'AB', 'r.ab', 1) returning id`),
          ).id
          const below = one<{ id: string }>(
            yield* database.execute(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${anchor}, ${orgType}, 'Deep', 'r.a.x', 2) returning id`),
          ).id
          // move the plain role's grant to a subtree anchor at r.a
          yield* database.execute(sql`
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
          const database = yield* Database
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          // give the anchored user tenant-wide grant administration, which is
          // authority over grants but not over the administrator role
          const permission = one<{ id: string }>(
            yield* database.execute(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('iam.tenant-grant.manage','iam','manage tenant grants','tenant')
              on conflict (code) do update set plugin = excluded.plugin returning id`),
          ).id
          const role = one<{ id: string }>(
            yield* database.execute(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode)
              values (${f.tenant},'granter','Granter','tenant','active','explicit') returning id`),
          ).id
          yield* database.execute(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${role}, ${permission})`)
          yield* database.execute(sql`
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
      // the bind escape hatch must not be a route to becoming superuser
      expect(answer.refused).toBe('ACCESS_DENIED')
      expect(answer.allowed).toBe('Success')
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
          const database = yield* Database
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const orgType = one<{ id: string }>(
            yield* database.execute(
              sql`select id from org_types where tenant_id = ${f.tenant} limit 1`,
            ),
          ).id
          // the role being handed out is an ordinary org role the granter holds
          yield* database.execute(sql`
            insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
            values (${f.tenant}, ${f.plainRole}, ${orgType})`)
          yield* database.execute(sql`
            insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
            select ${f.tenant}, ${f.plainRole}, id from user_types
            where tenant_id = ${f.tenant} limit 1`)

          // The granter holds the role's own capability at SUBTREE reach, so
          // the escalation guard would allow a subtree grant. Only their
          // authority over grants is narrower, which is what this isolates.
          yield* database.execute(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${f.anchored.userId}, ${f.plainRole}, ${f.child}, 'subtree')`)

          // the granter administers grants at the child node, self only
          const manage = one<{ id: string }>(
            yield* database.execute(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('iam.grant.manage','iam','manage grants','org-node')
              on conflict (code) do update set plugin = excluded.plugin returning id`),
          ).id
          const granterRole = one<{ id: string }>(
            yield* database.execute(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode)
              values (${f.tenant},'granter','Granter','org','active','explicit') returning id`),
          ).id
          yield* database.execute(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${granterRole}, ${manage})`)
          yield* database.execute(sql`
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
})
