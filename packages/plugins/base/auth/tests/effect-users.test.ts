import { sql } from 'drizzle-orm'
import { Effect, Exit, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Database, DatabaseConfig, layer as databaseLayer } from '@qualy/plugin-database/effect'
import { PermissionCatalog } from '@qualy/rbac-contract/effect'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { layer as rbacLayer } from '@qualy/plugin-rbac/effect'
import { Iam, layer as authLayer } from '../src/effect/index.ts'

// People, and who may administer them.
//
// Authority over a person is authority over the node they stand at, so the
// cases worth stating are the ones where that is not the node the caller was
// thinking of: a transfer touches two nodes, and a retype touches the grants
// the person already holds.

const catalog: readonly ActivePermission[] = [
  { code: 'auth.user.manage', name: 'manage users', target: 'org-node', plugin: 'auth' },
]

const stack = (url: string) =>
  authLayer.pipe(
    Layer.provideMerge(rbacLayer),
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

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Iam | Database>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

/** two branches, and an administrator who manages only the left one */
const seed = Effect.fn('seed')(function* () {
  const db = yield* Database
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* db.execute(sql`insert into tenants (slug, name) values ('t','T') returning id`),
  ).id
  const orgType = one<{ id: string }>(
    yield* db.execute(
      sql`insert into org_types (tenant_id, code, name) values (${tenant},'u','U') returning id`,
    ),
  ).id
  const node = (name: string, path: string, parent?: string) =>
    db.execute(sql`
      insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
      values (${tenant}, ${parent ?? null}, ${orgType}, ${name}, ${path}::ltree,
        ${path.split('.').length - 1})
      returning id`)
  const root = one<{ id: string }>(yield* node('Root', 'r')).id
  const left = one<{ id: string }>(yield* node('Left', 'r.left', root)).id
  const right = one<{ id: string }>(yield* node('Right', 'r.right', root)).id

  const staff = one<{ id: string }>(
    yield* db.execute(sql`
      insert into user_types (tenant_id, code, name, placement_mode, allow_local_login)
      values (${tenant}, 'staff', 'Staff', 'unrestricted', true) returning id`),
  ).id

  // a manager whose authority is the left branch and nothing else
  const manager = one<{ id: string }>(
    yield* db.execute(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Manager', ${staff}, ${root}) returning id`),
  ).id
  const role = one<{ id: string }>(
    yield* db.execute(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode)
      values (${tenant}, 'mgr', 'Mgr', 'org', 'active', 'explicit') returning id`),
  ).id
  const permission = one<{ id: string }>(
    yield* db.execute(sql`
      insert into permissions (code, plugin, name, target_kind)
      values ('auth.user.manage', 'auth', 'manage users', 'org-node')
      on conflict (code) do update set plugin = excluded.plugin returning id`),
  ).id
  yield* db.execute(sql`
    insert into role_permissions (tenant_id, role_id, permission_id)
    values (${tenant}, ${role}, ${permission})`)
  yield* db.execute(sql`
    insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
    values (${tenant}, ${manager}, ${role}, ${left}, 'subtree')`)

  const as: Principal = { tenantId: tenant, userId: manager, sessionId: 's' }
  return { tenant, root, left, right, staff, manager, as }
})

describe.runIf(postgresAvailable)('users', () => {
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
          const out = yield* Effect.result(
            iam.users.setPlacement(f.tenant, userId, f.right, f.as),
          )
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
          const database = yield* Database
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const other = one<{ id: string }>(
            yield* database.execute(sql`
              insert into org_types (tenant_id, code, name) values (${f.tenant},'club','Club')
              returning id`),
          ).id
          // staff may only stand at a club, and the left node is not one
          yield* database.execute(sql`
            update user_types set placement_mode = 'allow-list' where id = ${f.staff}`)
          yield* database.execute(sql`
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
          const database = yield* Database
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          // an administrator so the tenant survives the disable
          const adminRole = one<{ id: string }>(
            yield* database.execute(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
              values (${f.tenant},'admin','Admin','tenant','active','all-active','tenant-admin')
              returning id`),
          ).id
          yield* database.execute(sql`
            insert into role_grants (tenant_id, user_id, role_id)
            values (${f.tenant}, ${f.manager}, ${adminRole})`)

          const iam = yield* Iam
          const userId = yield* iam.users.create(
            f.tenant,
            { displayName: 'Ada', userTypeId: f.staff, primaryOrgNodeId: f.left },
            f.as,
          )
          yield* database.execute(sql`
            insert into sessions (tenant_id, user_id, token_hash, expires_at)
            values (${f.tenant}, ${userId}, 'hash', now() + interval '1 day')`)
          yield* iam.users.setEnabled(f.tenant, userId, false, f.as)
          const left = (yield* database.execute(
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
