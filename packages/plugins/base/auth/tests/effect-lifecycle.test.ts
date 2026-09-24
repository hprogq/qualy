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
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'

// The user lifecycle: what falls with a deletion, that deletion is final and
// frees what the person held, and the version fence every write runs behind.
// The trail is asserted through the audit table itself: the events are the
// contract, not a side effect.

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
      Layer.provideMerge(captchaLayer),
      Layer.provideMerge(secretsLayer),
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
              sessionCookieName: 'qualy_session',
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
 * A tenant with an administrator holding every permission everywhere, and
 * one ordinary person with an address, an identity, a session and an
 * org-role grant - everything a deletion has to take away.
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
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, business_no, email)
      values (${tenant}, 'Ada', ${staff}, ${root}, '20240001', 'ada@school.edu') returning id`),
  ).id
  yield* runSql(sql`
    insert into user_auth_bindings (tenant_id, user_id, auth_provider_id, subject, credential_hash)
    values (${tenant}, ${person}, ${provider}, null, 'hash')`)
  yield* runSql(sql`
    insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
    values (${tenant}, ${person}, ${provider}, 'session-hash', now() + interval '1 day')`)
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
  it('takes everything with a deletion, straight from active, and writes one event', async () => {
    const db = await createTestContext('lifecycle-delete')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          yield* iam.users.remove(f.tenant, f.person, 1, f.as)

          const grants = yield* count(
            'role_grants',
            sql`user_id = ${f.person} and revoked_at is null`,
          )
          const identities = yield* count(
            'user_auth_bindings',
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
          return { grants, identities, sessions, row, events }
        }),
      )
      const answer = ok(exit)
      expect(answer.grants).toBe(0)
      expect(answer.identities).toBe(0)
      expect(answer.sessions).toBe(0)
      expect(answer.row.deleted_at).not.toBeNull()
      expect(answer.row.enabled).toBe(false)
      expect(answer.row.version).toBe(2)
      // the tombstone keeps what it was, for whoever reads history by id
      expect(answer.row.business_no).toBe('20240001')
      // one act, one event: there is no separate stop at disabled any more
      expect(answer.events.map((event) => event.action_code)).toEqual(['auth.user.delete'])
      expect(answer.events[0]!.details).toMatchObject({
        revokedGrants: 1,
        revokedBindings: 1,
        endedSessions: 1,
      })
    } finally {
      await db.dispose()
    }
  })

  it('frees the number and the address, while history keeps the old row', async () => {
    const db = await createTestContext('lifecycle-reuse')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const input = {
            displayName: 'Ada again',
            userTypeId: f.staff,
            primaryOrgNodeId: f.root,
            businessNo: '20240001',
            email: 'Ada@School.edu ',
          }
          // while Ada is alive, both are taken
          const takenNumber = yield* Effect.result(
            iam.users.create(f.tenant, { ...input, email: 'other@school.edu' }, f.as),
          )
          const takenAddress = yield* Effect.result(
            iam.users.create(f.tenant, { ...input, businessNo: '20249999' }, f.as),
          )
          yield* iam.users.remove(f.tenant, f.person, 1, f.as)
          const successor = yield* iam.users.create(f.tenant, input, f.as)
          const rows = (yield* runSql<{
            id: string
            email: string | null
            deleted: boolean
          }>(
            sql`select id, email, deleted_at is not null as deleted from users
                where tenant_id = ${f.tenant} and business_no = '20240001' order by created_at, id`,
          )).rows
          const trail = (yield* runSql<{ target_id: string }>(
            sql`select target_id from audit_events
                where tenant_id = ${f.tenant} and action_code = 'auth.user.delete'`,
          )).rows
          return {
            takenNumber: tagOf(takenNumber),
            takenAddress: tagOf(takenAddress),
            successor,
            rows,
            trail,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.takenNumber).toBe('USER_CONFLICT')
      expect(answer.takenAddress).toBe('USER_EMAIL_CONFLICT')
      expect(answer.rows).toHaveLength(2)
      expect(answer.rows[1]).toMatchObject({
        id: answer.successor,
        // stored the way it is compared
        email: 'ada@school.edu',
        deleted: false,
      })
      expect(answer.rows[0]!.deleted).toBe(true)
      expect(answer.rows[0]!.id).not.toBe(answer.successor)
      // the deletion still names the person it removed, not their successor
      expect(answer.trail.map((row) => row.target_id)).toEqual([answer.rows[0]!.id])
    } finally {
      await db.dispose()
    }
  })

  it('reads the deleted as nobody, on every path', async () => {
    const db = await createTestContext('lifecycle-visibility')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          yield* iam.users.remove(f.tenant, f.person, 1, f.as)
          const listed = yield* iam.users.list(f.as, {
            orgNodeId: f.root,
            scope: 'subtree',
            limit: 10,
          })
          const paged = yield* iam.users.page(f.as, {
            orgNodeId: f.root,
            scope: 'subtree',
            status: 'disabled',
            page: 1,
            limit: 10,
          })
          const options = yield* iam.users.options(f.as, undefined, 10)
          const refusals = yield* Effect.all([
            Effect.result(iam.users.get(f.as, f.person)),
            Effect.result(iam.users.detail(f.as, f.person)),
            Effect.result(iam.users.update(f.tenant, f.person, { displayName: 'X' }, 2, f.as)),
            Effect.result(
              iam.users.setStatus(
                f.tenant,
                f.person,
                { status: 'active', expectedVersion: 2 },
                f.as,
              ),
            ),
            Effect.result(iam.users.remove(f.tenant, f.person, 2, f.as)),
          ])
          return {
            listed: listed.map((row) => row.displayName),
            pagedTotal: paged.total,
            rootCount: options.nodes.find((node) => node.orgNodeId === f.root)?.userCount,
            refusals: refusals.map(tagOf),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.listed).toEqual(['Admin'])
      expect(answer.pagedTotal).toBe(0)
      expect(answer.rootCount).toBe(1)
      expect(answer.refusals).toEqual([
        'USER_NOT_FOUND',
        'USER_NOT_FOUND',
        'USER_NOT_FOUND',
        'USER_NOT_FOUND',
        'USER_NOT_FOUND',
      ])
    } finally {
      await db.dispose()
    }
  })

  // Asking for what is already true is agreement, and agreement used to be
  // given before anybody asked whether the caller had any business asking.
  // A stranger who could name an id learned from the answer whether the
  // person existed and whether they were enabled.
  it('tells a stranger nothing by agreeing with them', async () => {
    const db = await createTestContext('lifecycle-noop-authz')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const f = yield* seed()
          const iam = yield* Iam
          // somebody in the tenant with no authority over anybody
          const stranger = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'Stranger', ${f.staff}, ${f.root}) returning id`),
          ).id
          const asStranger = { tenantId: f.tenant, userId: stranger, sessionId: 's' }
          // the person is enabled, so this asks for what already holds
          const agreeing = yield* Effect.result(
            iam.users.setStatus(
              f.tenant,
              f.person,
              { status: 'active', expectedVersion: 1 },
              asStranger,
            ),
          )
          // and the other way round, which used to be the refusal that told
          // them the same thing from the other side
          const changing = yield* Effect.result(
            iam.users.setStatus(
              f.tenant,
              f.person,
              { status: 'disabled', expectedVersion: 1 },
              asStranger,
            ),
          )
          const deleting = yield* Effect.result(iam.users.remove(f.tenant, f.person, 1, asStranger))
          // once gone, the person answers exactly like an id nobody ever had
          yield* iam.users.remove(f.tenant, f.person, 1, f.as)
          const gone = yield* Effect.result(
            iam.users.setStatus(
              f.tenant,
              f.person,
              { status: 'disabled', expectedVersion: 2 },
              asStranger,
            ),
          )
          const never = yield* Effect.result(
            iam.users.setStatus(
              f.tenant,
              '00000000-0000-7000-8000-000000000000',
              { status: 'disabled', expectedVersion: 1 },
              asStranger,
            ),
          )
          return {
            agreeing: tagOf(agreeing),
            changing: tagOf(changing),
            deleting: tagOf(deleting),
            gone: tagOf(gone),
            never: tagOf(never),
          }
        }),
      )
      const answer = ok(exit)
      // the two answers are the same answer, which is the whole point
      expect(answer.agreeing).toBe('ACCESS_DENIED')
      expect(answer.changing).toBe('ACCESS_DENIED')
      expect(answer.deleting).toBe('ACCESS_DENIED')
      expect(answer.gone).toBe('USER_NOT_FOUND')
      expect(answer.never).toBe(answer.gone)
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
          const staleDelete = yield* Effect.result(iam.users.remove(f.tenant, f.person, 7, f.as))
          return [tagOf(stale), tagOf(staleEdit), tagOf(staleMove), tagOf(staleDelete)]
        }),
      )
      expect(ok(exit)).toEqual([
        'USER_VERSION_CONFLICT',
        'USER_VERSION_CONFLICT',
        'USER_VERSION_CONFLICT',
        'USER_VERSION_CONFLICT',
      ])
    } finally {
      await db.dispose()
    }
  })

  it('will not delete the last administrator, and says so without deleting anything', async () => {
    const db = await createTestContext('lifecycle-last-admin')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const refused = yield* Effect.result(iam.users.remove(f.tenant, f.admin, 1, f.as))
          const row = (yield* runSql<{ deleted_at: string | null; enabled: boolean }>(
            sql`select deleted_at, enabled from users where id = ${f.admin}`,
          )).rows[0]!
          const grants = yield* count(
            'role_grants',
            sql`user_id = ${f.admin} and revoked_at is null`,
          )
          return { refused: tagOf(refused), row, grants }
        }),
      )
      const answer = ok(exit)
      expect(answer.refused).toBe('LAST_ADMINISTRATOR')
      // the whole deletion rolled back with the refusal
      expect(answer.row).toEqual({ deleted_at: null, enabled: true })
      expect(answer.grants).toBe(1)
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
