import { literal } from '@qualy/i18n-contract'
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
import { transaction, type Orm } from '@qualy/plugin-database/server'
import { db as rbacDb } from '../src/server/db.ts'
import { Rbac } from '@qualy/rbac-contract/effect'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { Access } from '../src/server/index.ts'
import { serviceLayer as rbacLayer } from '../src/server/index.ts'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { accessActions } from '../src/actions.ts'

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
  { code: 'org.tree.read', name: literal('read'), target: 'org-node', plugin: 'org' },
  { code: 'org.tree.manage', name: literal('manage'), target: 'org-node', plugin: 'org' },
  { code: 'iam.user.read', name: literal('users'), target: 'tenant', plugin: 'iam' },
]

// what the orm must know for a query to name a table
const closure = [...orgEntities, ...authEntities, ...rbacEntities, ...auditEntities] as const

const stack = (url: string) =>
  booted(
    rbacLayer.pipe(
      // provideMerge rather than provide: the tests write fixtures through the
      // same Database the layer uses, so it has to stay available above
      // the writer the audited services record through, on the same database
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

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Rbac | Access | Orm | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

/** the lists a policy names, or null when it names everything */
type EligibilityView = { holderPolicy: { mode: string; userTypeIds?: readonly string[] } }
type AnchorView = { anchorPolicy: { mode: string; orgTypeIds?: readonly string[] } | null }
const eligibleOf = (read: EligibilityView) => read.holderPolicy.userTypeIds ?? null
const anchoredOf = (read: AnchorView) => read.anchorPolicy?.orgTypeIds ?? null

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

  // the door the sign-in predicate looks for: without one enabled
  // provider admitting a type, nobody of that type can ever sign in
  yield* runSql(sql`
    insert into auth_providers (tenant_id, code, type, name)
    values (${tenant}, 'local', 'local', 'Local')`)
  const orgType = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_types (tenant_id, name) values (${tenant}, 'U') returning id`),
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
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${tenant}, 'staff', 'Staff', 'unrestricted') returning id`),
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
      insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${tenant}, 'local', 'Local', 'org', 'active', 'explicit', 'allow-list') returning id`),
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

  it('counts a resource-bound grant as standing somewhere, and nowhere in general', async () => {
    const db = await createTestContext('effect-rbac-resource-profile')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const rbac = yield* Rbac
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          // the same role the plain user holds, but granted only inside one
          // resource: authority in that round, none anywhere else
          const holder = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              select ${f.tenant}, 'Scoped Reviewer', u.user_type_id, ${f.root}
              from users u where u.tenant_id = ${f.tenant} limit 1
              returning id`),
          ).id
          yield* runSql(sql`
            insert into role_grants
              (tenant_id, user_id, role_id, org_node_id, coverage,
               resource_namespace, resource_type, resource_id)
            values (${f.tenant}, ${holder}, ${f.plainRole}, ${f.root}, 'self',
                    'assessment', 'batch', ${f.child})`)
          const scoped: Principal = { tenantId: f.tenant, userId: holder, sessionId: 's' }
          return {
            // the manifest's question: held somewhere, resource contexts included
            profile: yield* rbac.getProfile(scoped),
            // the general question: a resource-bound grant is no authority here
            general: yield* rbac.canAt(scoped, 'org.tree.manage', f.root),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.profile.orgPermissions).toContain('org.tree.manage')
      expect(answer.general).toBe(false)
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
          const disable = rbacDb.query((k) =>
            k.updateTable('User').set({ enabled: false }).where('id', '=', f.user).execute(),
          )
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
          const stillEnabled = yield* rbacDb.query((k) =>
            k
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
          // f.role is the canonical administrator; the target is somebody
          // else, because handing a role to oneself is refused before this
          const refused = yield* Effect.result(
            access.grants.grant(
              f.tenant,
              { userId: f.user, roleId: f.role, target: { kind: 'tenant' } },
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
              sql`select id from org_types where tenant_id = ${f.tenant} and name = 'U'`,
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
          // to somebody other than the actor: handing a role to oneself is
          // refused before the insert this test is about
          yield* access.grants.grant(
            f.tenant,
            { userId: f.anchored.userId, roleId: f.plainRole, target },
            f.principal,
          )
          return yield* Effect.result(
            access.grants.grant(
              f.tenant,
              { userId: f.anchored.userId, roleId: f.plainRole, target },
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

  it('records the grant in the trail, attributed to whoever handed it out', async () => {
    const db = await createTestContext('effect-grant-audit')
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
            yield* runSql(sql`select org_type_id as id from org_nodes where id = ${f.child}`),
          ).id
          yield* runSql(sql`
            insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
            values (${f.tenant}, ${f.plainRole}, ${staff})`)
          yield* runSql(sql`
            insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
            values (${f.tenant}, ${f.plainRole}, ${orgType})`)
          const grantId = yield* access.grants.grant(
            f.tenant,
            {
              userId: f.anchored.userId,
              roleId: f.plainRole,
              target: { kind: 'org-node', orgNodeId: f.child, coverage: 'self' },
            },
            f.principal,
          )
          const events = (yield* runSql<{
            action_code: string
            actor_user_id: string
            details: { userId?: string; roleId?: string }
          }>(sql`select action_code, actor_user_id, details from audit_events
              where tenant_id = ${f.tenant} and target_id = ${grantId}`)).rows
          return { events, actor: f.principal.userId, grantee: f.anchored.userId }
        }),
      )
      const { events, actor, grantee } = ok(exit)
      expect(events.map((event) => event.action_code)).toEqual(['iam.role-grant.create'])
      expect(events[0]!.actor_user_id).toBe(actor)
      expect(events[0]!.details.userId).toBe(grantee)
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
              insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${f.tenant},'granter','Granter','org','active','explicit', 'allow-list') returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${granterRole}, ${manage})`)
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${f.anchored.userId}, ${granterRole}, ${f.child}, 'self')`)
          // and the office is theirs to appoint, so only the reach question
          // remains in play
          yield* runSql(sql`
            insert into role_grant_rules (tenant_id, granter_role_id, target_role_id)
            values (${f.tenant}, ${granterRole}, ${f.plainRole})`)

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
          const roleId = yield* access.roles.create(
            f.tenant,
            {
              code: 'reviewer',
              name: 'Reviewer',
              kind: 'org',
            },
            f.principal,
          )
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
          const roleId = yield* access.roles.create(
            f.tenant,
            {
              code: 'wide',
              name: 'Wide',
              kind: 'tenant',
            },
            f.principal,
          )
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
          const roleId = yield* access.roles.create(
            f.tenant,
            {
              code: 'reviewer',
              name: 'Reviewer',
              kind: 'org',
            },
            f.principal,
          )
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
              sql`select id from org_types where tenant_id = ${f.tenant} and name = 'U'`,
            ),
          ).id
          const far = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.root}, ${orgType}, 'Far', 'r.f', 1) returning id`),
          ).id
          // a role anyone may hold, granted at both places
          const roleId = yield* access.roles.create(
            f.tenant,
            {
              code: 'local2',
              name: 'Local Two',
              kind: 'org',
            },
            f.principal,
          )
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
      // exactly the grant under the anchorPolicy: not the tenant-wide one, whose
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
              sql`select id from org_types where tenant_id = ${f.tenant} and name = 'U'`,
            ),
          ).id
          // an active, assignable role nobody is eligible for: it must not be
          // offered, because the write would refuse it
          const ineligible = yield* access.roles.create(
            f.tenant,
            {
              code: 'closed',
              name: 'Closed',
              kind: 'org',
            },
            f.principal,
          )
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

          // asked about somebody other than the asker: nothing is on offer
          // for oneself, and that refusal would drown the ones under test
          const offered = yield* access.grants.options(
            f.tenant,
            {
              userId: f.anchored.userId,
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
      // every candidate comes back; only one of them can actually be given,
      // and the others say why so a screen can pass the reason on
      expect(
        answer.offered.filter((role) => role.refusal === null).map((role) => role.code),
      ).toEqual(['local'])
      expect(answer.offered.find((role) => role.code === 'closed')?.refusal).toBe('user-type')
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
              insert into user_types (tenant_id, code, name, placement_mode)
              values (${f.tenant}, 'guest', 'Guest', 'unrestricted') returning id`),
          ).id
          const orgType = one<{ id: string }>(
            yield* runSql(
              sql`select id from org_types where tenant_id = ${f.tenant} and name = 'U'`,
            ),
          ).id

          const roleId = yield* access.roles.create(
            f.tenant,
            {
              code: 'wide',
              name: 'Wide',
              kind: 'tenant',
            },
            f.principal,
          )
          // a tenant role has no anchor policy, and the payload says so
          const version = yield* access.roles.setEligibility(
            f.tenant,
            roleId,
            {
              holderPolicy: { mode: 'allow-list', userTypeIds: [staff] },
              anchorPolicy: null,
            },
            1,
            f.principal,
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
                holderPolicy: { mode: 'allow-list', userTypeIds: [other] },
                anchorPolicy: null,
              },
              version,
              f.principal,
            ),
          )
          const unknown = yield* Effect.result(
            access.roles.setEligibility(
              f.tenant,
              roleId,
              {
                holderPolicy: {
                  mode: 'allow-list',
                  userTypeIds: ['00000000-0000-7000-8000-000000000000'],
                },
                anchorPolicy: null,
              },
              version,
              f.principal,
            ),
          )
          // the refusal has to have rolled the deletes back with it
          const after = yield* access.roles.getEligibility(f.tenant, roleId)
          return { stored, stranding, unknown, after, staff }
        }),
      )
      const answer = ok(exit)
      expect(eligibleOf(answer.stored)).toEqual([answer.staff])
      expect(answer.stored.anchorPolicy).toBeNull()
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
          const roleId = yield* access.roles.create(
            f.tenant,
            {
              code: 'open',
              name: 'Open',
              kind: 'tenant',
            },
            f.principal,
          )
          yield* access.roles.setPermissions(f.tenant, roleId, ['iam.user.read'], 1, f.principal)
          // a tenant role has no anchor dimension: sending a policy for it is
          // refused rather than repaired, so a replace can never become a lie
          const mismatched = yield* Effect.result(
            access.roles.setEligibility(
              f.tenant,
              roleId,
              { holderPolicy: { mode: 'unrestricted' }, anchorPolicy: { mode: 'unrestricted' } },
              2,
              f.principal,
            ),
          )
          const version = yield* access.roles.setEligibility(
            f.tenant,
            roleId,
            { holderPolicy: { mode: 'unrestricted' }, anchorPolicy: null },
            2,
            f.principal,
          )
          // an empty allow-list is refused here; the mode is what makes the
          // same empty table mean the opposite
          yield* access.roles.setStatus(f.tenant, roleId, 'active', version, f.principal)
          const read = yield* access.roles.getEligibility(f.tenant, roleId)

          // somebody of a type the role never named, and never could have
          const visitorType = one<{ id: string }>(
            yield* runSql(sql`
              insert into user_types (tenant_id, code, name, placement_mode)
              values (${f.tenant}, 'visitor', 'Visitor', 'unrestricted') returning id`),
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
          const anchored = yield* access.roles.create(
            f.tenant,
            {
              code: 'anywhere',
              name: 'Anywhere',
              kind: 'org',
            },
            f.principal,
          )
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
            { holderPolicy: { mode: 'unrestricted' }, anchorPolicy: { mode: 'unrestricted' } },
            2,
            f.principal,
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
          return { read, stranded, anchorRead, mismatched }
        }),
      )
      const answer = ok(exit)
      expect(tagOf(answer.mismatched)).toBe('ROLE_ANCHOR_MISMATCH')
      expect(answer.read.holderPolicy.mode).toBe('unrestricted')
      // a tenant role anchors to nothing, and now says nothing: null, not a
      // mode over an empty list pretending to be a rule
      expect(answer.read.anchorPolicy).toBeNull()
      expect(answer.stranded).toBe(0)
      expect(answer.anchorRead.anchorPolicy?.mode).toBe('unrestricted')
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
                holderPolicy: { mode: 'allow-list', userTypeIds: [] },
                anchorPolicy: { mode: 'allow-list', orgTypeIds: [] },
              },
              1,
              f.principal,
            ),
          )
          // the canonical administrator is grantable to whoever the tenant
          // designates, so it declares no eligibility to edit
          const admin = yield* Effect.result(
            access.roles.setEligibility(
              f.tenant,
              f.role,
              {
                holderPolicy: { mode: 'allow-list', userTypeIds: [] },
                anchorPolicy: { mode: 'allow-list', orgTypeIds: [] },
              },
              1,
              f.principal,
            ),
          )
          // a draft may be emptied: completeness is checked when it becomes usable
          const draft = yield* access.roles.create(
            f.tenant,
            {
              code: 'draft',
              name: 'Draft',
              kind: 'org',
            },
            f.principal,
          )
          yield* access.roles.setEligibility(
            f.tenant,
            draft,
            {
              holderPolicy: { mode: 'allow-list', userTypeIds: [] },
              anchorPolicy: { mode: 'allow-list', orgTypeIds: [] },
            },
            1,
            f.principal,
          )
          const emptyDraft = yield* access.roles.getEligibility(f.tenant, draft)
          return { emptied, admin, emptyDraft }
        }),
      )
      const answer = ok(exit)
      expect(tagOf(answer.emptied)).toBe('ROLE_NEEDS_ELIGIBILITY')
      expect(tagOf(answer.admin)).toBe('ROLE_IS_SYSTEM')
      expect(answer.emptyDraft).toMatchObject({
        holderPolicy: { mode: 'allow-list', userTypeIds: [] },
        anchorPolicy: { mode: 'allow-list', orgTypeIds: [] },
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
          const tenantRole = yield* access.roles.create(
            f.tenant,
            {
              code: 'wide',
              name: 'Wide',
              kind: 'tenant',
            },
            f.principal,
          )
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

  it('appoints only what a held rule names, from where it is held', async () => {
    const db = await createTestContext('effect-grant-rules')
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
              sql`select id from org_types where tenant_id = ${f.tenant} and name = 'U'`,
            ),
          ).id
          // a sibling subtree the actor does not stand over
          const other = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.root}, ${orgType}, 'Other', 'r.o', 1) returning id`),
          ).id
          const permission = (code: string) =>
            Effect.map(
              runSql(sql`
                insert into permissions (code, plugin, name, target_kind)
                values (${code}, 'org', ${code}, 'org-node')
                on conflict (code) do update set code = excluded.code returning id`),
              (result) => one<{ id: string }>(result).id,
            )
          const manage = yield* permission('iam.grant.manage')
          const tree = yield* permission('org.tree.manage')
          const role = (code: string, permissions: readonly string[]) =>
            Effect.gen(function* () {
              const created = one<{ id: string }>(
                yield* runSql(sql`
                  insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${f.tenant}, ${code}, ${code}, 'org', 'active', 'explicit', 'allow-list')
                  returning id`),
              ).id
              for (const id of permissions) {
                yield* runSql(sql`
                  insert into role_permissions (tenant_id, role_id, permission_id)
                  values (${f.tenant}, ${created}, ${id})`)
              }
              yield* runSql(sql`
                insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
                values (${f.tenant}, ${created}, ${staff})`)
              yield* runSql(sql`
                insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
                values (${f.tenant}, ${created}, ${orgType})`)
              return created
            })
          // Three offices with distinct jobs, so each refusal isolates one
          // rule. `granter` carries grant administration everywhere, and
          // nothing else: WHERE is answered wherever it is asked, and never
          // by the office the rule hangs on. `college-admin` bears the rule
          // and covers the counsellor's authority; `counsellor` is what gets
          // handed out.
          const granter = yield* role('granter', [manage])
          const collegeAdmin = yield* role('college-admin', [tree])
          const counsellor = yield* role('counsellor', [tree])
          yield* runSql(sql`
            insert into role_grant_rules (tenant_id, granter_role_id, target_role_id)
            values (${f.tenant}, ${collegeAdmin}, ${counsellor})`)
          // a third person to appoint things to, of the admitted type
          const li = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'Li', ${staff}, ${f.child}) returning id`),
          ).id
          // grant administration everywhere under the root; the appointing
          // office itself only over the child's subtree
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${f.anchored.userId}, ${granter}, ${f.root}, 'subtree')`)
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${f.anchored.userId}, ${collegeAdmin}, ${f.child}, 'subtree')`)

          const grant = (input: {
            userId: string
            roleId: string
            orgNodeId: string
            by: Principal
          }) =>
            Effect.result(
              access.grants.grant(
                f.tenant,
                {
                  userId: input.userId,
                  roleId: input.roleId,
                  target: { kind: 'org-node', orgNodeId: input.orgNodeId, coverage: 'self' },
                },
                input.by,
              ),
            )

          return {
            // the edge names counsellor, the holding stands over the child
            ruled: (yield* grant({
              userId: li,
              roleId: counsellor,
              orgNodeId: f.child,
              by: f.anchored,
            }))._tag,
            // no edge names college-admin: full authority, not their office
            // to fill - the question no-escalation cannot ask
            peer: tagOf(
              yield* grant({
                userId: li,
                roleId: collegeAdmin,
                orgNodeId: f.child,
                by: f.anchored,
              }),
            ),
            // the edge is held through a grant that does not stand over
            // there: grant administration reaches the sibling, the
            // appointing office does not
            elsewhere: tagOf(
              yield* grant({ userId: li, roleId: counsellor, orgNodeId: other, by: f.anchored }),
            ),
            // taking the office oneself: allowed, because counsellor adds
            // nothing anchored's own holdings do not already cover there
            themselves: (yield* grant({
              userId: f.anchored.userId,
              roleId: counsellor,
              orgNodeId: f.child,
              by: f.anchored,
            }))._tag,
            // the canonical administrator appoints without edges, being what
            // it is - while eligibility still holds (the admin is not staff
            // by type here, so the person checked is Li, not the actor)
            canonical: (yield* grant({
              userId: li,
              roleId: collegeAdmin,
              orgNodeId: f.child,
              by: f.principal,
            }))._tag,
            offered: (yield* access.grants.options(
              f.tenant,
              {
                userId: li,
                target: { kind: 'org-node', orgNodeId: f.child, coverage: 'self' },
              },
              f.anchored,
            )).map((candidate) => ({ code: candidate.code, refusal: candidate.refusal })),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.ruled).toBe('Success')
      expect(answer.peer).toBe('GRANT_RULE_REFUSED')
      expect(answer.elsewhere).toBe('GRANT_RULE_REFUSED')
      expect(answer.themselves).toBe('Success')
      expect(answer.canonical).toBe('Success')
      // the picker tells the same truth the write does
      expect(answer.offered.find((role) => role.code === 'counsellor')?.refusal).toBeNull()
      expect(answer.offered.find((role) => role.code === 'college-admin')?.refusal).toBe(
        'authority',
      )
    } finally {
      await db.dispose()
    }
  })

  it('lets one shed one\u2019s own role with the authority any revocation takes', async () => {
    const db = await createTestContext('effect-grant-self')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const rbac = yield* Rbac
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const own = one<{ id: string }>(
            yield* runSql(sql`
              select id from role_grants
              where tenant_id = ${f.tenant} and user_id = ${f.anchored.userId}
                and role_id = ${f.plainRole}`),
          ).id
          const keeps = (tenantId: string) => rbac.assertTenantKeepsAdministrator(tenantId)
          // shedding a role grows nobody, so being one's own is no refusal -
          // but the ordinary administer-grants authority still gates it, and
          // this holder has none
          const unauthorized = tagOf(
            yield* Effect.result(access.grants.revoke(f.tenant, own, f.anchored, keeps)),
          )
          // with grant administration over the anchor, one's own goes like
          // anyone's
          const manage = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('iam.grant.manage', 'rbac', 'manage', 'org-node')
              on conflict (code) do update set code = excluded.code returning id`),
          ).id
          const steward = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${f.tenant}, 'steward', 'Steward', 'org', 'active', 'explicit', 'allow-list')
              returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${steward}, ${manage})`)
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${f.anchored.userId}, ${steward}, ${f.root}, 'self')`)
          const shed = (yield* Effect.result(
            access.grants.revoke(f.tenant, own, f.anchored, keeps),
          ))._tag
          const remaining = one<{ count: string }>(
            yield* runSql(sql`
              select count(*) as count from role_grants
              where tenant_id = ${f.tenant} and id = ${own}`),
          ).count
          // and the last administrator still cannot remove themselves: the
          // guard reads the state a removal would leave, not who asked
          const adminGrant = one<{ id: string }>(
            yield* runSql(sql`
              select id from role_grants
              where tenant_id = ${f.tenant} and user_id = ${f.user} and role_id = ${f.role}`),
          ).id
          const lastAdmin = tagOf(
            yield* Effect.result(access.grants.revoke(f.tenant, adminGrant, f.principal, keeps)),
          )
          return { unauthorized, shed, remaining, lastAdmin }
        }),
      )
      const answer = ok(exit)
      expect(answer.unauthorized).toBe('ACCESS_DENIED')
      expect(answer.shed).toBe('Success')
      expect(answer.remaining).toBe('0')
      expect(answer.lastAdmin).toBe('LAST_ADMINISTRATOR')
    } finally {
      await db.dispose()
    }
  })

  it('lets a grant to another exceed the granter, and a grant to oneself never', async () => {
    const db = await createTestContext('effect-grant-appointment')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const staffType = one<{ id: string }>(
            yield* runSql(
              sql`select id from user_types where tenant_id = ${f.tenant} and code = 'staff'`,
            ),
          ).id
          const orgType = one<{ id: string }>(
            yield* runSql(
              sql`select id from org_types where tenant_id = ${f.tenant} and name = 'U'`,
            ),
          ).id
          const permission = (code: string) =>
            Effect.map(
              runSql(sql`
                insert into permissions (code, plugin, name, target_kind)
                values (${code}, 'org', ${code}, 'org-node')
                on conflict (code) do update set code = excluded.code returning id`),
              (result) => one<{ id: string }>(result).id,
            )
          const manage = yield* permission('iam.grant.manage')
          const review = yield* permission('org.tree.read')
          const role = (code: string, permissions: readonly string[]) =>
            Effect.gen(function* () {
              const created = one<{ id: string }>(
                yield* runSql(sql`
                  insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${f.tenant}, ${code}, ${code}, 'org', 'active', 'explicit', 'allow-list')
                  returning id`),
              ).id
              for (const id of permissions) {
                yield* runSql(sql`
                  insert into role_permissions (tenant_id, role_id, permission_id)
                  values (${f.tenant}, ${created}, ${id})`)
              }
              yield* runSql(sql`
                insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
                values (${f.tenant}, ${created}, ${staffType})`)
              yield* runSql(sql`
                insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
                values (${f.tenant}, ${created}, ${orgType})`)
              return created
            })
          // the personnel office: grant administration, an appointment edge,
          // and NONE of the reviewer's own capability - the model this
          // re-ruling exists for
          const personnel = yield* role('personnel', [manage])
          const reviewer = yield* role('reviewer', [review])
          yield* runSql(sql`
            insert into role_grant_rules (tenant_id, granter_role_id, target_role_id)
            values (${f.tenant}, ${personnel}, ${reviewer})`)
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${f.anchored.userId}, ${personnel}, ${f.root}, 'subtree')`)
          const li = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'Li', ${staffType}, ${f.child}) returning id`),
          ).id
          const grant = (userId: string, by: Principal) =>
            Effect.result(
              access.grants.grant(
                f.tenant,
                {
                  userId,
                  roleId: reviewer,
                  target: { kind: 'org-node', orgNodeId: f.child, coverage: 'self' },
                },
                by,
              ),
            )
          // appointing another needs no personal share of the office's
          // duties: the edge IS the authority
          const appointed = (yield* grant(li, f.anchored))._tag
          // taking it oneself is the one grant that would grow its taker,
          // and it is refused with no escape
          const themselves = tagOf(yield* grant(f.anchored.userId, f.anchored))
          // the canonical administrator holds everything, so taking a
          // business identity adds nothing and goes through - the whole
          // "the admin wants to sit in a review chain" scenario
          const canonicalSelf = (yield* grant(f.user, f.principal))._tag
          const offered = yield* access.grants.options(
            f.tenant,
            {
              userId: f.anchored.userId,
              target: { kind: 'org-node', orgNodeId: f.child, coverage: 'self' },
            },
            f.anchored,
          )
          return {
            appointed,
            themselves,
            canonicalSelf,
            selfOffer: offered.find((candidate) => candidate.code === 'reviewer')?.refusal,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.appointed).toBe('Success')
      expect(answer.themselves).toBe('GRANT_ESCALATION_REFUSED')
      expect(answer.canonicalSelf).toBe('Success')
      // the picker names the self case its own thing, not a missing office
      expect(answer.selfOffer).toBe('self-escalation')
    } finally {
      await db.dispose()
    }
  })

  it('holds the appointment graph to what an edge now means', async () => {
    const db = await createTestContext('effect-appointment-edges')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const permission = (code: string, target: string) =>
            Effect.map(
              runSql(sql`
                insert into permissions (code, plugin, name, target_kind)
                values (${code}, 'rbac', ${code}, ${target})
                on conflict (code) do update set code = excluded.code returning id`),
              (result) => one<{ id: string }>(result).id,
            )
          const manage = yield* permission('iam.grant.manage', 'org-node')
          const role = (code: string, kind: string, permissions: readonly string[] = []) =>
            Effect.gen(function* () {
              const created = one<{ id: string }>(
                yield* runSql(sql`
                  insert into roles (tenant_id, code, name, kind, status, permission_mode, eligibility_mode, anchor_mode)
                  values (${f.tenant}, ${code}, ${code}, ${kind}, 'active', 'explicit', 'unrestricted',
                          ${kind === 'org' ? 'unrestricted' : null})
                  returning id`),
              ).id
              for (const id of permissions) {
                yield* runSql(sql`
                  insert into role_permissions (tenant_id, role_id, permission_id)
                  values (${f.tenant}, ${created}, ${id})`)
              }
              return created
            })
          const a = yield* role('office-a', 'org', [manage])
          const b = yield* role('office-b', 'org', [manage])
          const c = yield* role('office-c', 'org', [manage])
          const powerless = yield* role('office-powerless', 'org')
          const tenantOffice = yield* role('office-tenant', 'tenant')
          const set = (granter: string, targets: readonly string[], by: Principal) =>
            Effect.result(access.roles.setGrantableRoles(f.tenant, granter, targets, 1, by))
          return {
            // a role cannot appoint itself
            selfEdge: tagOf(yield* set(a, [a], f.principal)),
            // an office of one kind cannot appoint the other kind: an org
            // office held somewhere can never execute a tenant appointment
            kind: tagOf(yield* set(a, [tenantOffice], f.principal)),
            // an office with no grant administration of its own must not
            // claim to appoint - the latent edge nobody can read
            latent: tagOf(yield* set(powerless, [a], f.principal)),
            // a legal chain stands
            chain: (yield* set(a, [b], f.principal))._tag,
            deeper: (yield* set(b, [c], f.principal))._tag,
            // and closing it into a ring is refused wherever it is tried
            ring: tagOf(yield* set(c, [a], f.principal)),
            // an author may only draw edges to authority they hold, with the
            // named exception; this author holds nothing tenant-wide
            beyond: tagOf(yield* set(c, [b], f.anchored)),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.selfEdge).toBe('ROLE_APPOINTMENT_INVALID')
      expect(answer.kind).toBe('ROLE_APPOINTMENT_INVALID')
      expect(answer.latent).toBe('ROLE_APPOINTMENT_INVALID')
      expect(answer.chain).toBe('Success')
      expect(answer.deeper).toBe('Success')
      expect(answer.ring).toBe('ROLE_APPOINTMENT_INVALID')
      expect(answer.beyond).toBe('ROLE_ESCALATION_REFUSED')
    } finally {
      await db.dispose()
    }
  })

  // A withdrawn grant stops authorizing the moment it is withdrawn, and used
  // to go on obstructing everything administration asks about grants: the
  // person could not be retyped, the office could not be deleted, and the
  // grants screen still offered the dead row as manageable.
  it('stops counting a withdrawn grant wherever grants are administered', async () => {
    const db = await createTestContext('effect-grant-withdrawn')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const rbac = yield* Rbac
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const staff = one<{ id: string }>(
            yield* runSql(
              sql`select id from user_types where tenant_id = ${f.tenant} and code = 'staff'`,
            ),
          ).id
          const guest = one<{ id: string }>(
            yield* runSql(sql`
              insert into user_types (tenant_id, code, name, placement_mode)
              values (${f.tenant}, 'guest', 'Guest', 'unrestricted') returning id`),
          ).id
          const tree = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('org.tree.read', 'org', 'read', 'org-node')
              on conflict (code) do update set code = excluded.code returning id`),
          ).id
          // an office only staff may hold, given for one batch and then
          // unstaffed: the one path in the product that soft-revokes
          const office = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode,
                                 eligibility_mode, anchor_mode)
              values (${f.tenant}, 'batch-reviewer', 'Batch reviewer', 'org', 'active',
                      'explicit', 'allow-list', 'unrestricted')
              returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${office}, ${tree})`)
          yield* runSql(sql`
            insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
            values (${f.tenant}, ${office}, ${staff})`)
          const assignment = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage,
                                       resource_namespace, resource_type, resource_id)
              values (${f.tenant}, ${f.anchored.userId}, ${office}, ${f.root}, 'self',
                      'assessment', 'batch', ${f.child})
              returning id`),
          ).id
          const blockingBefore = yield* rbac.grantsBlockingUserType(
            f.tenant,
            f.anchored.userId,
            guest,
          )
          yield* rbac.revokeAssignment({
            tenantId: f.tenant,
            assignmentId: assignment,
            actorId: f.user,
          })
          const listed = yield* access.grants.list(
            f.tenant,
            { userId: f.anchored.userId },
            yield* access.grantScopeFor(f.principal),
          )
          const projected = yield* access.roles.get(f.tenant, office, f.principal)
          const holdings = yield* rbac.listUserRoles(f.tenant, f.anchored.userId)
          return {
            blockingBefore,
            blockingAfter: yield* rbac.grantsBlockingUserType(f.tenant, f.anchored.userId, guest),
            listedIds: listed.map((row) => row.id),
            holdingIds: holdings.map((row) => row.grantId),
            assignment,
            grantCount: projected.role.grantCount,
            // the office has no holders left, so deleting it is not "in use"
            removal: (yield* Effect.result(
              access.roles.remove(f.tenant, office, projected.role.version, f.principal),
            ))._tag,
          }
        }),
      )
      const answer = ok(exit)
      // one fewer grant obstructs the retype: the withdrawn one
      expect(answer.blockingAfter).toBe(answer.blockingBefore - 1)
      expect(answer.listedIds).not.toContain(answer.assignment)
      // the screen and the user's own roles panel now say the same thing
      expect(answer.listedIds).toEqual(answer.holdingIds)
      expect(answer.grantCount).toBe(0)
      expect(answer.removal).toBe('Success')
    } finally {
      await db.dispose()
    }
  })

  it('refuses to strip the capability an office’s appointment edges stand on', async () => {
    const db = await createTestContext('effect-appointment-capability')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const permission = (code: string) =>
            Effect.map(
              runSql(sql`
                insert into permissions (code, plugin, name, target_kind)
                values (${code}, 'org', ${code}, 'org-node')
                on conflict (code) do update set code = excluded.code returning id`),
              (result) => one<{ id: string }>(result).id,
            )
          const manage = yield* permission('iam.grant.manage')
          const tree = yield* permission('org.tree.read')
          const role = (code: string, permissions: readonly string[]) =>
            Effect.gen(function* () {
              const created = one<{ id: string }>(
                yield* runSql(sql`
                  insert into roles (tenant_id, code, name, kind, status, permission_mode,
                                     eligibility_mode, anchor_mode)
                  values (${f.tenant}, ${code}, ${code}, 'org', 'active', 'explicit',
                          'unrestricted', 'unrestricted')
                  returning id`),
              ).id
              for (const id of permissions) {
                yield* runSql(sql`
                  insert into role_permissions (tenant_id, role_id, permission_id)
                  values (${f.tenant}, ${created}, ${id})`)
              }
              return created
            })
          const clerk = yield* role('batch-clerk', [manage])
          const reviewer = yield* role('reviewer', [tree])
          const edged = yield* access.roles.setGrantableRoles(
            f.tenant,
            clerk,
            [reviewer],
            1,
            f.principal,
          )
          // the edit an administrator believed removed the appointment power
          const stripped = yield* Effect.result(
            access.roles.setPermissions(f.tenant, clerk, ['org.tree.read'], edged, f.principal),
          )
          const kept = yield* access.roles.getPermissions(f.tenant, clerk, f.principal)
          // clearing the edges first is what makes the same edit legal
          const cleared = yield* access.roles.setGrantableRoles(
            f.tenant,
            clerk,
            [],
            (yield* access.roles.getGrantableRoles(f.tenant, clerk)).version,
            f.principal,
          )
          const after = yield* Effect.result(
            access.roles.setPermissions(f.tenant, clerk, ['org.tree.read'], cleared, f.principal),
          )
          return {
            stripped: tagOf(stripped),
            reason: (stripped as { failure?: { reason?: string } }).failure?.reason,
            kept: kept.active,
            after: after._tag,
            standing: (yield* access.roles.getGrantableRoles(f.tenant, clerk)).roleIds,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.stripped).toBe('ROLE_APPOINTMENT_INVALID')
      expect(answer.reason).toBe('granter-capability')
      // the refusal rolled back with the transaction: the office still carries
      // what holds its edges up
      expect(answer.kept).toContain('iam.grant.manage')
      expect(answer.after).toBe('Success')
      expect(answer.standing).toEqual([])
    } finally {
      await db.dispose()
    }
  })

  it('refuses a self-grant that would take an office’s appointment edges', async () => {
    const db = await createTestContext('effect-grant-self-appointment')
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
          const permission = (code: string) =>
            Effect.map(
              runSql(sql`
                insert into permissions (code, plugin, name, target_kind)
                values (${code}, 'org', ${code}, 'org-node')
                on conflict (code) do update set code = excluded.code returning id`),
              (result) => one<{ id: string }>(result).id,
            )
          const manage = yield* permission('iam.grant.manage')
          const tree = yield* permission('org.tree.read')
          const role = (code: string, permissions: readonly string[]) =>
            Effect.gen(function* () {
              const created = one<{ id: string }>(
                yield* runSql(sql`
                  insert into roles (tenant_id, code, name, kind, status, permission_mode,
                                     eligibility_mode, anchor_mode)
                  values (${f.tenant}, ${code}, ${code}, 'org', 'active', 'explicit',
                          'unrestricted', 'unrestricted')
                  returning id`),
              ).id
              for (const id of permissions) {
                yield* runSql(sql`
                  insert into role_permissions (tenant_id, role_id, permission_id)
                  values (${f.tenant}, ${created}, ${id})`)
              }
              return created
            })
          const edge = (granter: string, target: string) =>
            runSql(sql`
              insert into role_grant_rules (tenant_id, granter_role_id, target_role_id)
              values (${f.tenant}, ${granter}, ${target})`)
          // Three personnel offices differing only in their edges, which is
          // the shape the design recommends: every granter carries the same
          // grant administration, so a permission comparison between two of
          // them is a guaranteed no-op.
          const outer = yield* role('office-outer', [manage])
          const middle = yield* role('office-middle', [manage])
          const inner = yield* role('office-inner', [tree])
          yield* edge(outer, middle)
          yield* edge(middle, inner)
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${f.anchored.userId}, ${outer}, ${f.root}, 'subtree')`)
          const li = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'Li', ${staff}, ${f.child}) returning id`),
          ).id
          const take = (userId: string) =>
            Effect.result(
              access.grants.grant(
                f.tenant,
                {
                  userId,
                  roleId: middle,
                  target: { kind: 'org-node', orgNodeId: f.root, coverage: 'subtree' },
                },
                f.anchored,
              ),
            )
          const themselves = yield* take(f.anchored.userId)
          const offered = yield* access.grants.options(
            f.tenant,
            {
              userId: f.anchored.userId,
              target: { kind: 'org-node', orgNodeId: f.root, coverage: 'subtree' },
            },
            f.anchored,
          )
          // appointing somebody else into the office is untouched: a
          // third-party grant is the appointment graph's call alone
          const another = yield* take(li)
          // and once she may appoint the inner office directly, taking the
          // middle one adds nothing left to add
          yield* edge(outer, inner)
          const afterEdge = yield* take(f.anchored.userId)
          return {
            themselves: tagOf(themselves),
            withheld: (themselves as { failure?: { permissions?: readonly string[] } }).failure
              ?.permissions,
            offer: offered.find((candidate) => candidate.code === 'office-middle')?.refusal,
            another: another._tag,
            afterEdge: afterEdge._tag,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.themselves).toBe('GRANT_ESCALATION_REFUSED')
      // the refusal says appointment authority was what would have been
      // gained, and says it without naming an office: the payload crosses to
      // a client, and which offices exist is an identity, not a capability
      expect(answer.withheld).toEqual(['appointment-authority'])
      // the picker refuses it for the same reason the write does
      expect(answer.offer).toBe('self-escalation')
      expect(answer.another).toBe('Success')
      expect(answer.afterEdge).toBe('Success')
    } finally {
      await db.dispose()
    }
  })

  it('explains a tenant capability the same way require does, node or no node', async () => {
    const db = await createTestContext('effect-explain-tenant')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const access = yield* Access
          const rbac = yield* Rbac
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const users = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('iam.user.read', 'iam', 'users', 'tenant')
              on conflict (code) do update set code = excluded.code returning id`),
          ).id
          // an ordinary tenant role, not the recovery account: its grant is
          // tenant-wide, so anchor and coverage are null together
          const officer = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode,
                                 eligibility_mode)
              values (${f.tenant}, 'registry', 'Registry', 'tenant', 'active', 'explicit',
                      'unrestricted')
              returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${officer}, ${users})`)
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id)
            values (${f.tenant}, ${f.anchored.userId}, ${officer})`)
          const evaluated = yield* access.diagnostics.evaluate(f.tenant, {
            userId: f.anchored.userId,
            permissionCode: 'iam.user.read',
            orgNodeId: f.root,
          })
          return {
            decided: yield* rbac.hasPermission(f.anchored, 'iam.user.read'),
            evaluated,
            atRoot: (yield* access.diagnostics.explain(f.tenant, f.anchored.userId, f.root)).map(
              (row) => row.code,
            ),
            // the org side is unchanged: self coverage still stops at its
            // own node, so naming a node cannot start admitting everything
            atChild: (yield* access.diagnostics.explain(f.tenant, f.anchored.userId, f.child)).map(
              (row) => row.code,
            ),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.decided).toBe(true)
      expect(answer.evaluated.allowed).toBe(true)
      expect(answer.evaluated.sources).toHaveLength(1)
      expect(answer.evaluated.sources[0]!.target).toMatchObject({ kind: 'tenant' })
      expect(answer.atRoot).toContain('iam.user.read')
      expect(answer.atRoot).toContain('org.tree.manage')
      expect(answer.atChild).toEqual(['iam.user.read'])
    } finally {
      await db.dispose()
    }
  })
})
