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
import { type Orm } from '@qualy/plugin-database/server'
import { PermissionCatalog } from '@qualy/rbac-contract/effect'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { layer as rbacLayer } from '@qualy/plugin-rbac/server'
import { loginDriversLayer } from '@qualy/auth-contract/login'
import { AuthConfig } from '../src/server/sign-in.ts'
import { Iam, layer as authLayer } from '../src/server/index.ts'

// People, and who may administer them.
//
// Authority over a person is authority over the node they stand at, so the
// cases worth stating are the ones where that is not the node the caller was
// thinking of: a transfer touches two nodes, and a retype touches the grants
// the person already holds.

const catalog: readonly ActivePermission[] = [
  { code: 'auth.user.manage', name: 'manage users', target: 'org-node', plugin: 'auth' },
  // reading is its own permission: a read-only administrator gets a screen
  // without buttons rather than buttons that answer 403
  { code: 'auth.user.read', name: 'read users', target: 'org-node', plugin: 'auth' },
]

const stack = (url: string) =>
  authLayer.pipe(
    Layer.provideMerge(rbacLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        databaseFor(url, { entities: authClosure }),
        Layer.succeed(PermissionCatalog, catalog),
        loginDriversLayer,
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

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Iam | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

const one_ = <T>(result: unknown) => (result as { rows: T[] }).rows[0]! as T & { id: string }

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

/** two branches, and an administrator who manages only the left one */
const seed = Effect.fn('seed')(function* () {
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('t','T') returning id`),
  ).id
  const orgType = one<{ id: string }>(
    yield* runSql(
      sql`insert into org_types (tenant_id, code, name) values (${tenant},'u','U') returning id`,
    ),
  ).id
  const node = (name: string, path: string, parent?: string) =>
    runSql(sql`
      insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
      values (${tenant}, ${parent ?? null}, ${orgType}, ${name}, ${path}::ltree,
        ${path.split('.').length - 1})
      returning id`)
  const root = one<{ id: string }>(yield* node('Root', 'r')).id
  const left = one<{ id: string }>(yield* node('Left', 'r.left', root)).id
  const right = one<{ id: string }>(yield* node('Right', 'r.right', root)).id

  const staff = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode, allow_local_login)
      values (${tenant}, 'staff', 'Staff', 'unrestricted', true) returning id`),
  ).id

  // a manager whose authority is the left branch and nothing else
  const manager = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Manager', ${staff}, ${root}) returning id`),
  ).id
  const role = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode)
      values (${tenant}, 'mgr', 'Mgr', 'org', 'active', 'explicit') returning id`),
  ).id
  const permission = one<{ id: string }>(
    yield* runSql(sql`
      insert into permissions (code, plugin, name, target_kind)
      values ('auth.user.manage', 'auth', 'manage users', 'org-node')
      on conflict (code) do update set plugin = excluded.plugin returning id`),
  ).id
  yield* runSql(sql`
    insert into role_permissions (tenant_id, role_id, permission_id)
    values (${tenant}, ${role}, ${permission})`)
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
    values (${tenant}, ${manager}, ${role}, ${left}, 'subtree')`)

  // Reading is granted separately and deliberately unevenly: one node at the
  // root, and the whole right branch. The left branch, which the manager may
  // change, is not readable through it, which is what makes the intersection
  // visible rather than incidental.
  const readRole = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode)
      values (${tenant}, 'reader', 'Reader', 'org', 'active', 'explicit') returning id`),
  ).id
  const readPermission = one<{ id: string }>(
    yield* runSql(sql`
      insert into permissions (code, plugin, name, target_kind)
      values ('auth.user.read', 'auth', 'read users', 'org-node')
      on conflict (code) do update set plugin = excluded.plugin returning id`),
  ).id
  yield* runSql(sql`
    insert into role_permissions (tenant_id, role_id, permission_id)
    values (${tenant}, ${readRole}, ${readPermission})`)
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
    values (${tenant}, ${manager}, ${readRole}, ${root}, 'self'),
           (${tenant}, ${manager}, ${readRole}, ${right}, 'subtree')`)

  const person = (name: string, at: string) =>
    runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, ${name}, ${staff}, ${at}) returning id`)
  const onLeft = one<{ id: string }>(yield* person('Ada', left)).id
  const onRight = one<{ id: string }>(yield* person('Grace', right)).id

  const as: Principal = { tenantId: tenant, userId: manager, sessionId: 's' }
  return { tenant, root, left, right, staff, manager, as, onLeft, onRight }
})

describe.runIf(postgresAvailable).concurrent('users', () => {
  it('lets a manager create only inside the branch they manage', async () => {
    const db = await createTestContext('effect-users-create')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const inside = yield* Effect.result(
            iam.users.create(
              f.tenant,
              { displayName: 'Ada', userTypeId: f.staff, primaryOrgNodeId: f.left },
              f.as,
            ),
          )
          const outside = yield* Effect.result(
            iam.users.create(
              f.tenant,
              { displayName: 'Grace', userTypeId: f.staff, primaryOrgNodeId: f.right },
              f.as,
            ),
          )
          return { inside: inside._tag, outside: tagOf(outside) }
        }),
      )
      const answer = ok(exit)
      expect(answer.inside).toBe('Success')
      expect(answer.outside).toBe('ACCESS_DENIED')
    } finally {
      await db.dispose()
    }
  })

  it('needs authority at both ends of a transfer', async () => {
    // moving someone changes who administers them, so managing only where
    // they are now is not enough
    const db = await createTestContext('effect-users-transfer')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const userId = yield* iam.users.create(
            f.tenant,
            { displayName: 'Ada', userTypeId: f.staff, primaryOrgNodeId: f.left },
            f.as,
          )
          // out of the managed branch: refused even though the source is managed
          const out = yield* Effect.result(iam.users.setPlacement(f.tenant, userId, f.right, f.as))
          // within it: allowed
          const within = yield* Effect.result(
            iam.users.setPlacement(f.tenant, userId, f.left, f.as),
          )
          return { out: tagOf(out), within: within._tag }
        }),
      )
      const answer = ok(exit)
      expect(answer.out).toBe('ACCESS_DENIED')
      expect(answer.within).toBe('Success')
    } finally {
      await db.dispose()
    }
  })

  it('refuses a placement the type does not permit', async () => {
    const db = await createTestContext('effect-users-placement')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const other = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_types (tenant_id, code, name) values (${f.tenant},'club','Club')
              returning id`),
          ).id
          // staff may only stand at a club, and the left node is not one
          yield* runSql(sql`
            update user_types set placement_mode = 'allow-list' where id = ${f.staff}`)
          yield* runSql(sql`
            insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
            values (${f.tenant}, ${f.staff}, ${other})`)
          const iam = yield* Iam
          const refused = yield* Effect.result(
            iam.users.create(
              f.tenant,
              { displayName: 'Ada', userTypeId: f.staff, primaryOrgNodeId: f.left },
              f.as,
            ),
          )
          return tagOf(refused)
        }),
      )
      expect(ok(exit)).toBe('USER_TYPE_PLACEMENT_NOT_ALLOWED')
    } finally {
      await db.dispose()
    }
  })

  it('ends every session when a person is disabled', async () => {
    const db = await createTestContext('effect-users-disable')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          // an administrator so the tenant survives the disable
          const adminRole = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
              values (${f.tenant},'admin','Admin','tenant','active','all-active','tenant-admin')
              returning id`),
          ).id
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id)
            values (${f.tenant}, ${f.manager}, ${adminRole})`)

          const iam = yield* Iam
          const userId = yield* iam.users.create(
            f.tenant,
            { displayName: 'Ada', userTypeId: f.staff, primaryOrgNodeId: f.left },
            f.as,
          )
          yield* runSql(sql`
            insert into sessions (tenant_id, user_id, token_hash, expires_at)
            values (${f.tenant}, ${userId}, 'hash', now() + interval '1 day')`)
          yield* iam.users.setEnabled(f.tenant, userId, false, f.as)
          const left = (yield* runSql(
            sql`select count(*)::int as count from sessions where user_id = ${userId}`,
          )) as unknown as { rows: { count: number }[] }
          return left.rows[0]!.count
        }),
      )
      // access ends now, not when the session happens to expire
      expect(ok(exit)).toBe(0)
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable).concurrent('what a caller may read about people', () => {
  it('intersects the requested scope with the one the caller was actually granted', async () => {
    // The recorded failure: the requested scope alone decided this, so a bare
    // self grant at a node returned every user below it. A partial subtree is
    // the correct answer here, not an error.
    const db = await createTestContext('effect-users-read')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          // asked for the whole tree; granted read at the root itself and
          // over the right branch only
          const all = yield* iam.users.list(f.as, {
            orgNodeId: f.root,
            scope: 'subtree',
            limit: 50,
          })
          // asked for one node only
          const justRoot = yield* iam.users.list(f.as, {
            orgNodeId: f.root,
            scope: 'self',
            limit: 50,
          })
          // a caller granted nothing sees nothing, and is not told why
          const stranger = one_(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'Nobody', ${f.staff}, ${f.right}) returning id`),
          ).id
          const blind: Principal = { tenantId: f.tenant, userId: stranger, sessionId: 's' }
          const nothing = yield* iam.users.list(blind, {
            orgNodeId: f.root,
            scope: 'subtree',
            limit: 50,
          })
          const hidden = yield* Effect.result(iam.users.get(blind, f.onLeft))
          // read and manage are asked independently, so a person the manager
          // may change is not thereby a person they may read
          const unreadable = yield* Effect.result(iam.users.get(f.as, f.onLeft))
          const visible = yield* iam.users.get(f.as, f.onRight)
          const search = yield* iam.users.list(f.as, {
            orgNodeId: f.root,
            scope: 'subtree',
            search: 'race',
            limit: 50,
          })
          return { all, justRoot, nothing, hidden, unreadable, visible, search }
        }),
      )
      const answer = ok(exit)
      // Ada is inside the requested subtree and outside the granted one, so
      // she is absent. This is the assertion the recorded bug fails.
      expect(answer.all.map((row) => row.displayName).sort()).toEqual(['Grace', 'Manager'])
      // the manager stands at the root, and is the only one there
      expect(answer.justRoot.map((row) => row.displayName)).toEqual(['Manager'])
      // seen but not editable: two permissions, two answers
      expect(answer.visible.manageable).toBe(false)
      expect(tagOf(answer.unreadable)).toBe('USER_NOT_FOUND')
      // not-found and not-readable are indistinguishable on purpose
      expect(answer.nothing).toEqual([])
      expect(tagOf(answer.hidden)).toBe('USER_NOT_FOUND')
      expect(answer.search.map((row) => row.displayName)).toEqual(['Grace'])
    } finally {
      await db.dispose()
    }
  })

  it('offers every node inside the coverage, not the anchors the grants sit on', async () => {
    // A subtree grant at a college means every department under it is a place
    // a user may stand; returning only the anchor made those unreachable.
    const db = await createTestContext('effect-user-options')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const orgType = one_(
            yield* runSql(
              sql`select id from org_types where tenant_id = ${f.tenant} and code = 'u'`,
            ),
          ).id
          // a node below the subtree anchor: it is a place a user may stand,
          // and returning only the anchor made it unreachable
          yield* runSql(sql`
            insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
            values (${f.tenant}, ${f.right}, ${orgType}, 'Under', 'r.right.under', 2)`)
          const options = yield* iam.users.options(f.as, undefined, 200)
          // truncation is reported rather than presented as the whole list
          const cut = yield* iam.users.options(f.as, undefined, 1)
          return { options, cut }
        }),
      )
      const answer = ok(exit)
      // Root by its own anchor, and the right branch through a subtree
      // anchor: Deep sits under an anchor the caller may manage but not read,
      // so it is not a place this screen offers
      expect(answer.options.nodes.map((node) => node.name)).toEqual(['Root', 'Right', 'Under'])
      expect(answer.options.nodes.find((node) => node.name === 'Under')!.manageable).toBe(false)
      // the assignable types come back with what each admits, so the screen
      // pairs a person with a place in one round trip
      expect(answer.options.userTypes.map((type) => type.code)).toEqual(['staff'])
      expect(answer.options.userTypes[0]!.placementPolicy).toEqual({ mode: 'unrestricted' })
      expect(answer.options.truncated).toBe(false)
      expect(answer.cut.nodes).toHaveLength(1)
      expect(answer.cut.truncated).toBe(true)
    } finally {
      await db.dispose()
    }
  })
})
