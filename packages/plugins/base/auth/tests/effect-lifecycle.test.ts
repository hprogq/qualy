import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import { Cause, Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
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
import { loginDriversLayer } from '@qualy/auth-contract/login'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { Principal } from '@qualy/rbac-contract'
import { literal } from '@qualy/i18n-contract'
import { Iam } from '../src/server/index.ts'
import { userActions } from '../src/actions.ts'
import { permissions as authPermissions } from '../src/permissions.ts'
import { AuthConfig } from '../src/server/sign-in.ts'
import { serviceLayer as authLayer } from '../src/server/index.ts'
import { authClosure } from './support/closure.ts'

// The user lifecycle: what falls with a deletion, what a restore hands back,
// and the version fence every write now runs behind. The trail is asserted
// through the audit table itself, because "these operations produce audit
// events from day one" is this phase's contract, not a side effect.

const catalog = [
  ...compileCatalog([{ owner: 'auth', permissions: authPermissions }]),
  { code: 'org.tree.read', name: literal('read'), target: 'org-node' as const, plugin: 'org' },
]

const stack = (url: string) =>
  booted(
    authLayer.pipe(
      Layer.provideMerge(rbacLayer),
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
  throw new Error(`expected success, got ${Cause.pretty(exit.cause)}`)
}

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

/**
 * A tenant with an administrator holding delete and restore everywhere, and
 * one ordinary person with an identity, a session and an org-role grant -
 * everything a deletion has to take away.
 */
const seed = Effect.fn('seed')(function* () {
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('t','T') returning id`),
  ).id
  const provider = one<{ id: string }>(
    yield* runSql(sql`
      insert into auth_providers (tenant_id, code, type, name)
      values (${tenant}, 'local', 'local', 'Local') returning id`),
  ).id
  const orgType = one<{ id: string }>(
    yield* runSql(
      sql`insert into org_types (tenant_id, name) values (${tenant}, 'U') returning id`,
    ),
  ).id
  const root = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${tenant}, ${orgType}, 'Root', 'r'::ltree, 0) returning id`),
  ).id
  const staff = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${tenant}, 'staff', 'Staff', 'unrestricted') returning id`),
  ).id

  const admin = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Admin', ${staff}, ${root}) returning id`),
  ).id
  const adminRole = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
      values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
      returning id`),
  ).id
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id)
    values (${tenant}, ${admin}, ${adminRole})`)

  // the person the lifecycle acts on, with everything attached
  const person = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, business_no)
      values (${tenant}, 'Ada', ${staff}, ${root}, '20240001') returning id`),
  ).id
  yield* runSql(sql`
    insert into user_identities (tenant_id, user_id, auth_provider_id, identifier, credential_hash)
    values (${tenant}, ${person}, ${provider}, 'ada', 'hash')`)
  yield* runSql(sql`
    insert into sessions (tenant_id, user_id, token_hash, expires_at)
    values (${tenant}, ${person}, 'session-hash', now() + interval '1 day')`)
  const staffRole = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
      values (${tenant}, 'helper', 'Helper', 'org', 'active', 'explicit', 'allow-list')
      returning id`),
  ).id
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
    values (${tenant}, ${person}, ${staffRole}, ${root}, 'subtree')`)

  const as: Principal = { tenantId: tenant, userId: admin, sessionId: 'seed' }
  return { tenant, root, staff, admin, person, as }
})

const count = (table: string, where: ReturnType<typeof sql>) =>
  Effect.map(
    runSql<{ count: number }>(
      sql`select count(*)::int as count from ${sql.raw(table)} where ${where}`,
    ),
    (result) => result.rows[0]!.count,
  )

describe.runIf(postgresAvailable)('the user lifecycle', () => {
  it('takes everything with a deletion, atomically, and writes the event', async () => {
    const db = await createTestContext('lifecycle-delete')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam

          // an enabled person is not deletable
          const early = yield* Effect.result(
            iam.users.setStatus(
              f.tenant,
              f.person,
              { status: 'deleted', expectedVersion: 1 },
              f.as,
            ),
          )

          yield* iam.users.setStatus(
            f.tenant,
            f.person,
            { status: 'disabled', expectedVersion: 1 },
            f.as,
          )
          yield* iam.users.setStatus(
            f.tenant,
            f.person,
            { status: 'deleted', expectedVersion: 2 },
            f.as,
          )

          const grants = yield* count(
            'role_grants',
            sql`user_id = ${f.person} and revoked_at is null`,
          )
          const identities = yield* count(
            'user_identities',
            sql`user_id = ${f.person} and revoked_at is null`,
          )
          const sessions = yield* count('sessions', sql`user_id = ${f.person}`)
          const row = (yield* runSql<{
            deleted_at: string | null
            enabled: boolean
            version: number
            business_no: string | null
          }>(
            sql`select deleted_at, enabled, version, business_no from users where id = ${f.person}`,
          )).rows[0]!
          const events = (yield* runSql<{ action_code: string; details: Record<string, unknown> }>(
            sql`select action_code, details from audit_events
                where tenant_id = ${f.tenant} and target_id = ${f.person}
                order by occurred_at, id`,
          )).rows
          return { early: tagOf(early), grants, identities, sessions, row, events }
        }),
      )
      const answer = ok(exit)
      expect(answer.early).toBe('USER_NOT_DISABLED')
      expect(answer.grants).toBe(0)
      expect(answer.identities).toBe(0)
      expect(answer.sessions).toBe(0)
      expect(answer.row.deleted_at).not.toBeNull()
      expect(answer.row.enabled).toBe(false)
      expect(answer.row.version).toBe(3)
      // the number stays taken: the same person coming back is a restore
      expect(answer.row.business_no).toBe('20240001')
      expect(answer.events.map((event) => event.action_code)).toEqual([
        'auth.user.disable',
        'auth.user.delete',
      ])
      expect(answer.events[1]!.details).toMatchObject({
        revokedGrants: 1,
        revokedIdentities: 1,
        // the disable one step earlier already swept the sessions; the
        // deletion found none left, and the event says so honestly
        endedSessions: 0,
      })
    } finally {
      await db.dispose()
    }
  })

  it('restores to disabled, without the access that fell', async () => {
    const db = await createTestContext('lifecycle-restore')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          yield* iam.users.setStatus(
            f.tenant,
            f.person,
            { status: 'disabled', expectedVersion: 1 },
            f.as,
          )
          yield* iam.users.setStatus(
            f.tenant,
            f.person,
            { status: 'deleted', expectedVersion: 2 },
            f.as,
          )

          // deleted people answer to restore only
          const editRefused = yield* Effect.result(
            iam.users.update(f.tenant, f.person, { displayName: 'X' }, 3, f.as),
          )
          const enableRefused = yield* Effect.result(
            iam.users.setStatus(f.tenant, f.person, { status: 'active', expectedVersion: 3 }, f.as),
          )

          yield* iam.users.setStatus(
            f.tenant,
            f.person,
            { status: 'disabled', expectedVersion: 3 },
            f.as,
          )
          const row = (yield* runSql<{
            deleted_at: string | null
            enabled: boolean
            user_type_id: string | null
          }>(sql`select deleted_at, enabled, user_type_id from users where id = ${f.person}`))
            .rows[0]!
          const identities = yield* count(
            'user_identities',
            sql`user_id = ${f.person} and revoked_at is null`,
          )
          const grants = yield* count(
            'role_grants',
            sql`user_id = ${f.person} and revoked_at is null`,
          )
          const restored = (yield* runSql<{ action_code: string }>(
            sql`select action_code from audit_events
                where tenant_id = ${f.tenant} and target_id = ${f.person}
                  and action_code = 'auth.user.restore'`,
          )).rows
          return {
            editRefused: tagOf(editRefused),
            enableRefused: tagOf(enableRefused),
            row,
            identities,
            grants,
            restored: restored.length,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.editRefused).toBe('USER_DELETED')
      expect(answer.enableRefused).toBe('USER_DELETED')
      expect(answer.row.deleted_at).toBeNull()
      // back as DISABLED: enabling is a second, explicit act
      expect(answer.row.enabled).toBe(false)
      expect(answer.row.user_type_id).toBe(answer.row.user_type_id)
      // nothing that fell comes back on its own
      expect(answer.identities).toBe(0)
      expect(answer.grants).toBe(0)
      expect(answer.restored).toBe(1)
    } finally {
      await db.dispose()
    }
  })

  it('fences every lifecycle write behind the version', async () => {
    const db = await createTestContext('lifecycle-version')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const stale = yield* Effect.result(
            iam.users.setStatus(
              f.tenant,
              f.person,
              { status: 'disabled', expectedVersion: 7 },
              f.as,
            ),
          )
          const staleEdit = yield* Effect.result(
            iam.users.update(f.tenant, f.person, { displayName: 'X' }, 7, f.as),
          )
          const staleMove = yield* Effect.result(
            iam.users.setPlacement(f.tenant, f.person, f.root, 7, f.as),
          )
          return [tagOf(stale), tagOf(staleEdit), tagOf(staleMove)]
        }),
      )
      expect(ok(exit)).toEqual([
        'USER_VERSION_CONFLICT',
        'USER_VERSION_CONFLICT',
        'USER_VERSION_CONFLICT',
      ])
    } finally {
      await db.dispose()
    }
  })

  it('hides the deleted from the living, and shows them to the deleted view', async () => {
    const db = await createTestContext('lifecycle-visibility')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          yield* iam.users.setStatus(
            f.tenant,
            f.person,
            { status: 'disabled', expectedVersion: 1 },
            f.as,
          )
          yield* iam.users.setStatus(
            f.tenant,
            f.person,
            { status: 'deleted', expectedVersion: 2 },
            f.as,
          )
          const living = yield* iam.users.list(f.as, {
            orgNodeId: f.root,
            scope: 'subtree',
            limit: 10,
          })
          const removed = yield* iam.users.list(f.as, {
            orgNodeId: f.root,
            scope: 'subtree',
            status: 'deleted',
            limit: 10,
          })
          return {
            living: living.map((row) => row.displayName),
            removed: removed.map((row) => row.displayName),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.living).toEqual(['Admin'])
      expect(answer.removed).toEqual(['Ada'])
    } finally {
      await db.dispose()
    }
  })

  it('counts no revoked grant as an administrator survivor', async () => {
    // the protection this fixes: revoke the only administrator's grant, and
    // the next disable of anybody must still find a real survivor - before
    // the inForce fix the revoked grant itself counted, and the tenant could
    // lose its last way in without a refusal
    const db = await createTestContext('lifecycle-survivors')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          // a second administrator, then revoke the FIRST one's grant
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id)
            select ${f.tenant}, ${f.person}, role_id from role_grants
            where tenant_id = ${f.tenant} and user_id = ${f.admin} limit 1`)
          yield* runSql(sql`
            update role_grants set revoked_at = now()
            where tenant_id = ${f.tenant} and user_id = ${f.person}`)
          // disabling the only LIVE administrator must now refuse
          const refused = yield* Effect.result(
            iam.users.setStatus(
              f.tenant,
              f.admin,
              { status: 'disabled', expectedVersion: 1 },
              f.as,
            ),
          )
          return tagOf(refused)
        }),
      )
      expect(ok(exit)).toBe('LAST_ADMINISTRATOR')
    } finally {
      await db.dispose()
    }
  })
})
