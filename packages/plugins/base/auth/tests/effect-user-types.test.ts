import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as orgPermissions } from '@qualy/plugin-org/permissions'
import { permissions as authPermissions } from '@qualy/plugin-auth/permissions'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import type { Principal } from '@qualy/rbac-contract'
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
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { userActions } from '@qualy/plugin-auth/actions'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../src/constants.ts'
import { loginDriversLayer } from '@qualy/auth-contract/login'
import { AuthConfig } from '../src/server/sign-in.ts'
import { Iam } from '../src/server/index.ts'
import { serviceLayer as authLayer } from '../src/server/index.ts'

// User types under Effect.
//
// A type carries no authority, so what is worth testing is not what it grants
// but what it keeps possible: a tenant that can still administer itself, and a
// role that still admits somebody. Both of those fail quietly.

// the same declarations production compiles, stamped the same way
const catalog = compileCatalog([
  { owner: 'org', permissions: orgPermissions },
  { owner: 'auth', permissions: authPermissions },
  { owner: 'rbac', permissions: rbacPermissions },
])

const stack = (url: string) =>
  booted(
    authLayer.pipe(
      Layer.provideMerge(rbacLayer),
      // the writer the auth services record through, on the same database
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([{ owner: 'auth', actions: userActions }]),
            ),
          ),
        ),
      ),
      Layer.provideMerge(
        Layer.mergeAll(
          databaseFor(url, { entities: authClosure }),
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
    ),
    { catalog },
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Iam | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

const seed = Effect.fn('seed')(function* () {
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('t','T') returning id`),
  ).id

  // the door the sign-in predicate looks for: without one enabled
  // provider admitting a type, nobody of that type can ever sign in
  yield* runSql(sql`
    insert into auth_providers (tenant_id, code, type, name)
    values (${tenant}, 'local', 'local', 'Local')`)
  const orgType = one<{ id: string }>(
    yield* runSql(
      sql`insert into org_types (tenant_id, name) values (${tenant}, 'U') returning id`,
    ),
  ).id
  const node = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${tenant}, ${orgType}, 'Root', 'r', 0) returning id`),
  ).id
  const makeType = (code: string) =>
    runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${tenant}, ${code}, ${code}, 'unrestricted') returning id`)
  const staff = one<{ id: string }>(yield* makeType('staff')).id
  const system = one<{ id: string }>(yield* makeType(SYSTEM_ACCOUNT_USER_TYPE)).id

  // a tenant that can administer itself. Without this every channel-closing
  // edit is refused, which is correct but would make the test measure the
  // wrong thing.
  const admin = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Ada', ${system}, ${node}) returning id`),
  ).id
  const adminRole = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
      values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
      returning id`),
  ).id
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id) values (${tenant}, ${admin}, ${adminRole})`)

  const as: Principal = { tenantId: tenant, userId: admin, sessionId: 'seed' }
  return { tenant, node, staff, system, as }
})

describe.runIf(postgresAvailable).concurrent('user types', () => {
  it('refuses an edit whose expected version has moved on', async () => {
    const db = await createTestContext('effect-ut-version')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const next = yield* iam.userTypes.update(f.tenant, f.staff, { name: 'Staff!' }, 1, f.as)
          // the caller still holding version 1 is refused, and told where it is
          const stale = yield* Effect.result(
            iam.userTypes.update(f.tenant, f.staff, { name: 'Again' }, 1, f.as),
          )
          return {
            next,
            tag: tagOf(stale),
            current:
              stale._tag === 'Failure'
                ? (stale.failure as { currentVersion?: number }).currentVersion
                : undefined,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.next).toBe(2)
      expect(answer.tag).toBe('USER_TYPE_VERSION_CONFLICT')
      // the current version travels with the refusal so a client can re-read
      expect(answer.current).toBe(2)
    } finally {
      await db.dispose()
    }
  })

  // The version is optimistic concurrency, so bumping it is a claim that the
  // stored value moved. A form re-saved with every field at its current value
  // makes no such claim, and used to invalidate every editor holding the old
  // version - the exact spurious conflict the version exists to prevent.
  it('leaves the version alone when a patch states only values already stored', async () => {
    const db = await createTestContext('effect-ut-noop')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const named = yield* iam.userTypes.update(f.tenant, f.staff, { name: 'Staff!' }, 1, f.as)
          const resaved = yield* iam.userTypes.update(
            f.tenant,
            f.staff,
            { name: 'Staff!' },
            named,
            f.as,
          )
          // and a caller still holding that version can still make a real edit
          const real = yield* iam.userTypes.update(
            f.tenant,
            f.staff,
            { name: 'Staff?' },
            resaved,
            f.as,
          )
          return { named, resaved, real }
        }),
      )
      const answer = ok(exit)
      expect(answer.named).toBe(2)
      expect(answer.resaved).toBe(2)
      expect(answer.real).toBe(3)
    } finally {
      await db.dispose()
    }
  })

  it('keeps a door open to the type a tenant recovers itself with', async () => {
    const db = await createTestContext('effect-ut-recovery')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const provider = one<{ id: string; version: number }>(
            yield* runSql(
              sql`select id, version from auth_providers where tenant_id = ${f.tenant}`,
            ),
          )
          // narrowing the only door past the recovery account is refused: a
          // tenant that cannot sign its system account in cannot recover
          const closed = yield* Effect.result(
            iam.providers.setAudience(
              f.tenant,
              provider.id,
              { mode: 'allow-list', userTypeIds: [f.staff] },
              provider.version,
              f.as,
            ),
          )
          // an audience that keeps the recovery account is an ordinary edit
          const kept = yield* iam.providers.setAudience(
            f.tenant,
            provider.id,
            { mode: 'allow-list', userTypeIds: [f.staff, f.system] },
            provider.version,
            f.as,
          )
          const read = (yield* iam.providers.list(f.tenant)).find((row) => row.id === provider.id)!
          return { closed: tagOf(closed), kept, read }
        }),
      )
      const answer = ok(exit)
      expect(answer.closed).toBe('RECOVERY_CHANNEL_REQUIRED')
      expect(answer.kept).toBe(2)
      expect(answer.read.version).toBe(2)
      expect(answer.read.audience.mode).toBe('allow-list')
    } finally {
      await db.dispose()
    }
  })

  it('refuses to disable or delete a type people still hold', async () => {
    const db = await createTestContext('effect-ut-in-use')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.tenant}, 'Ada', ${f.staff}, ${f.node})`)
          const iam = yield* Iam
          const disable = yield* Effect.result(
            iam.userTypes.setEnabled(f.tenant, f.staff, false, 1, f.as),
          )
          const remove = yield* Effect.result(iam.userTypes.remove(f.tenant, f.staff, 1, f.as))
          return {
            disable: tagOf(disable),
            count:
              disable._tag === 'Failure'
                ? (disable.failure as { userCount?: number }).userCount
                : undefined,
            remove: tagOf(remove),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.disable).toBe('USER_TYPE_IN_USE')
      // the count says how many people must be moved first
      expect(answer.count).toBe(1)
      expect(answer.remove).toBe('USER_TYPE_IN_USE')
    } finally {
      await db.dispose()
    }
  })

  it('leaves out of an edit whatever the caller left out', async () => {
    const db = await createTestContext('effect-ut-partial')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          yield* iam.userTypes.update(
            f.tenant,
            f.staff,
            { description: 'the one to keep' },
            1,
            f.as,
          )
          // a patch naming only the name must not clear the description, and
          // naming description: null must clear it. Both are the same absent
          // value in json, so only the presence of the key can tell them apart
          yield* iam.userTypes.update(f.tenant, f.staff, { name: 'Renamed' }, 2, f.as)
          const kept = yield* iam.userTypes.get(f.tenant, f.staff)
          yield* iam.userTypes.update(f.tenant, f.staff, { description: null }, 3, f.as)
          const cleared = yield* iam.userTypes.get(f.tenant, f.staff)
          return { kept: kept.description, name: kept.name, cleared: cleared.description }
        }),
      )
      const answer = ok(exit)
      expect(answer.kept).toBe('the one to keep')
      expect(answer.name).toBe('Renamed')
      expect(answer.cleared).toBeNull()
    } finally {
      await db.dispose()
    }
  })

  it('treats asking for the state it is already in as not an edit', async () => {
    const db = await createTestContext('effect-ut-noop')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          // already enabled: this must not spend a version, or it would
          // invalidate another edit in flight for no reason
          return yield* iam.userTypes.setEnabled(f.tenant, f.staff, true, 1, f.as)
        }),
      )
      expect(ok(exit)).toBe(1)
    } finally {
      await db.dispose()
    }
  })

  it('refuses to delete a type that is the last one a role admits', async () => {
    const db = await createTestContext('effect-ut-stranded')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const role = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode)
              values (${f.tenant}, 'r', 'R', 'tenant', 'active', 'explicit') returning id`),
          ).id
          // the role admits this type and no other
          yield* runSql(sql`
            insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
            values (${f.tenant}, ${role}, ${f.staff})`)
          const iam = yield* Iam
          const blocked = yield* Effect.result(iam.userTypes.remove(f.tenant, f.staff, 1, f.as))
          return {
            tag: tagOf(blocked),
            roles:
              blocked._tag === 'Failure'
                ? (blocked.failure as { roleCount?: number }).roleCount
                : undefined,
          }
        }),
      )
      const answer = ok(exit)
      // deleting it would leave the role assignable to nobody, which is the
      // inert state the lifecycle exists to prevent
      expect(answer.tag).toBe('USER_TYPE_LAST_FOR_ROLE')
      expect(answer.roles).toBe(1)
    } finally {
      await db.dispose()
    }
  })

  it('refuses a policy that would strand the people already standing', async () => {
    const db = await createTestContext('effect-ut-policy')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const other = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_types (tenant_id, name) values (${f.tenant}, 'Club')
              returning id`),
          ).id
          const orgType = one<{ id: string }>(
            yield* runSql(sql`select org_type_id as id from org_nodes where id = ${f.node}`),
          ).id
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.tenant}, 'Grace', ${f.staff}, ${f.node})`)

          const iam = yield* Iam
          // allowing only the type they stand on is fine
          const ok1 = yield* iam.userTypes.setPlacementPolicy(
            f.tenant,
            f.staff,
            { mode: 'allow-list', orgTypeIds: [orgType] },
            1,
            f.as,
          )
          // narrowing to a type they do NOT stand on strands them
          const strands = yield* Effect.result(
            iam.userTypes.setPlacementPolicy(
              f.tenant,
              f.staff,
              { mode: 'allow-list', orgTypeIds: [other] },
              ok1,
              f.as,
            ),
          )
          // and so does clearing the list entirely, which is the case the old
          // code skipped: it only checked when the new list was non-empty
          const cleared = yield* Effect.result(
            iam.userTypes.setPlacementPolicy(
              f.tenant,
              f.staff,
              { mode: 'allow-list', orgTypeIds: [] },
              ok1,
              f.as,
            ),
          )
          return {
            allowed: ok1,
            strands: tagOf(strands),
            cleared: tagOf(cleared),
            count:
              cleared._tag === 'Failure'
                ? (cleared.failure as { userCount?: number }).userCount
                : undefined,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.allowed).toBe(2)
      expect(answer.strands).toBe('USER_TYPE_PLACEMENT_IN_USE')
      // an empty allow-list means nowhere, not anywhere
      expect(answer.cleared).toBe('USER_TYPE_PLACEMENT_IN_USE')
      expect(answer.count).toBe(1)
    } finally {
      await db.dispose()
    }
  })

  it('treats an unchanged policy as not an edit', async () => {
    const db = await createTestContext('effect-ut-policy-noop')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          // already unrestricted with an empty list
          return yield* iam.userTypes.setPlacementPolicy(
            f.tenant,
            f.staff,
            { mode: 'unrestricted', orgTypeIds: [] },
            1,
            f.as,
          )
        }),
      )
      expect(ok(exit)).toBe(1)
    } finally {
      await db.dispose()
    }
  })

  it("refuses to change a system type's placement policy", async () => {
    const db = await createTestContext('effect-ut-policy-system')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          yield* runSql(sql`
            update user_types set is_system = true where id = ${f.system}`)
          const iam = yield* Iam
          const blocked = yield* Effect.result(
            iam.userTypes.setPlacementPolicy(
              f.tenant,
              f.system,
              { mode: 'allow-list', orgTypeIds: [] },
              1,
              f.as,
            ),
          )
          return tagOf(blocked)
        }),
      )
      expect(ok(exit)).toBe('USER_TYPE_IS_SYSTEM')
    } finally {
      await db.dispose()
    }
  })
})
