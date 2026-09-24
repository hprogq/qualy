import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as authPermissions } from '@qualy/plugin-auth/permissions'
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
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'
import { type Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import {
  loginDriversLayer,
  registerLoginDriver,
  type LoginDriver,
} from '@qualy/auth-contract/login'
import { driver as localDriver } from '@qualy/plugin-auth-local'
import { userActions } from '../src/actions.ts'
import { AuthConfig } from '../src/server/auth-config.ts'
import { Iam, serviceLayer as authLayer } from '../src/server/index.ts'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../src/constants.ts'
import { authClosure } from './support/closure.ts'

// The signed-in person's own account: who they are on file, the ways in open
// to them, and letting go of an account they bound.
//
// Every read and write here is about the principal and takes no person: the
// cases are what the reader sees of themselves, and the one rule letting go
// is held to - a way in must remain.

const literal = (value: string) => ({ kind: 'literal' as const, value })

/** an account only the person binds, found by the subject it carries */
const hub: LoginDriver = {
  type: 'hub',
  presentation: { mode: 'redirect', href: ({ code }) => `/auth/hub/${code}/start` },
  provisioning: { mode: 'tenant-managed', entrance: { label: literal('Hub'), fields: [] } },
  resolution: { mode: 'binding-subject' },
  binding: { mode: 'self', start: ({ code }) => `/auth/hub/${code}/start?intent=bind` },
}

/** a door that finds people by their person identifier and keeps nothing */
const campus: LoginDriver = {
  type: 'campus',
  presentation: { mode: 'redirect', href: ({ code }) => `/auth/campus/${code}/start` },
  provisioning: { mode: 'tenant-managed', entrance: { label: literal('Campus'), fields: [] } },
  resolution: { mode: 'user-field', field: 'businessNo' },
}

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
          Layer.mergeAll(
            registerLoginDriver(localDriver),
            registerLoginDriver(hub),
            registerLoginDriver(campus),
          ).pipe(Layer.provideMerge(loginDriversLayer)),
          uiLayer,
          Layer.succeed(
            AuthConfig,
            AuthConfig.of({
              defaultTenantSlug: 'default',
              sessionTtlSeconds: 3600,
              secureCookies: false,
              sessionCookieName: 'qualy_session',
            }),
          ),
        ),
      ),
    ),
    { catalog: compileCatalog([{ owner: 'auth', permissions: authPermissions }]) },
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Iam | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${Cause.pretty(exit.cause)}`)
}

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/**
 * Ada, who signs in with a password and has also bound a hub account, each
 * with a session of its own; Lin, who has only the hub account; and the
 * tenant's system account.
 */
const seed = (url: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tenant = one<{ id: string }>(
        yield* runSql(sql`insert into tenants (slug, name) values ('default','D') returning id`),
      ).id
      const orgType = one<{ id: string }>(
        yield* runSql(
          sql`insert into org_types (tenant_id, name) values (${tenant}, 'U') returning id`,
        ),
      ).id
      const root = one<{ id: string }>(
        yield* runSql(sql`
          insert into org_nodes (tenant_id, org_type_id, name, path, depth)
          values (${tenant}, ${orgType}, 'Root', 'r', 0) returning id`),
      ).id
      const system = one<{ id: string }>(
        yield* runSql(sql`
          insert into user_types (tenant_id, code, name, placement_mode, is_system)
          values (${tenant}, ${SYSTEM_ACCOUNT_USER_TYPE}, 'System', 'unrestricted', true)
          returning id`),
      ).id
      const staff = one<{ id: string }>(
        yield* runSql(sql`
          insert into user_types (tenant_id, code, name, placement_mode)
          values (${tenant}, 'staff', 'Staff', 'unrestricted') returning id`),
      ).id
      const person = (
        name: string,
        email: string | null,
        businessNo: string | null,
        type: string,
      ) =>
        Effect.map(
          runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email, business_no)
            values (${tenant}, ${name}, ${type}, ${root}, ${email}, ${businessNo}) returning id`),
          (result) => one<{ id: string }>(result).id,
        )
      const admin = yield* person('Admin', 'root@school.edu', null, system)
      const ada = yield* person('Ada', 'ada@school.edu', null, staff)
      const lin = yield* person('Lin', null, '20990007', staff)
      const door = (code: string, type: string) =>
        Effect.map(
          runSql(sql`
            insert into auth_providers (tenant_id, code, type, name, enabled, sort_order)
            values (${tenant}, ${code}, ${type}, ${code}, true, 0) returning id`),
          (result) => one<{ id: string }>(result).id,
        )
      const local = yield* door('local', 'local')
      const hubDoor = yield* door('hub', 'hub')
      const bind = (
        userId: string,
        providerId: string,
        subject: string | null,
        hash: string | null,
      ) =>
        Effect.map(
          runSql(sql`
            insert into user_auth_bindings (tenant_id, user_id, auth_provider_id, subject, credential_hash, display_label)
            values (${tenant}, ${userId}, ${providerId}, ${subject}, ${hash}, ${subject === null ? null : `@${subject}`})
            returning id`),
          (result) => one<{ id: string }>(result).id,
        )
      yield* bind(admin, local, null, 'digest')
      yield* bind(admin, hubDoor, 'hub-admin', null)
      const adaPassword = yield* bind(ada, local, null, 'digest')
      const adaHub = yield* bind(ada, hubDoor, 'hub-ada', null)
      const linHub = yield* bind(lin, hubDoor, 'hub-lin', null)
      const session = (userId: string, providerId: string, bindingId: string, mark: string) =>
        Effect.map(
          runSql(sql`
            insert into sessions (tenant_id, user_id, auth_provider_id, auth_binding_id, token_hash, expires_at)
            values (${tenant}, ${userId}, ${providerId}, ${bindingId}, repeat(${mark}, 64), now() + interval '1 day')
            returning id`),
          (result) => one<{ id: string }>(result).id,
        )
      const adaByPassword = yield* session(ada, local, adaPassword, 'a')
      const adaByHub = yield* session(ada, hubDoor, adaHub, 'b')
      const linByHub = yield* session(lin, hubDoor, linHub, 'c')
      return {
        tenant,
        root,
        admin,
        ada,
        lin,
        local,
        hubDoor,
        adaHub,
        adaPassword,
        adaByPassword,
        adaByHub,
        linByHub,
        as: (userId: string, sessionId: string): Principal => ({
          tenantId: tenant,
          userId,
          sessionId,
        }),
      }
    }).pipe(Effect.provide(databaseFor(url, { migrations: 'off', entities: authClosure }))),
  )

describe.runIf(postgresAvailable)('the reader’s own account', () => {
  it('says who they are, and how they can sign in', async () => {
    const db = await createTestContext('self-read')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const me = f.as(f.ada, f.adaByPassword)
            return {
              profile: yield* iam.self.profile(me),
              entrances: yield* iam.self.entrances(me),
              byHub: yield* iam.self.entrances(f.as(f.ada, f.adaByHub)),
            }
          }),
        ),
      )
      expect(answer.profile).toMatchObject({
        id: f.ada,
        displayName: 'Ada',
        email: 'ada@school.edu',
        emailVerified: false,
        businessNo: null,
        userType: { name: 'Staff' },
        unit: { id: f.root, name: 'Root' },
      })
      expect(
        answer.entrances.map((entrance) => ({
          type: entrance.type,
          bound: entrance.bound?.displayLabel ?? entrance.bound !== null,
          unbindable: entrance.unbindable,
          thisSession: entrance.thisSession,
        })),
      ).toEqual([
        // in the sign-in page's order, which for two doors at one position is by name
        { type: 'hub', bound: '@hub-ada', unbindable: true, thisSession: false },
        // a password is the administrator's to manage, never the reader's to drop
        { type: 'local', bound: true, unbindable: false, thisSession: true },
      ])
      // asked from the session that came in through the hub account, that one is marked
      expect(answer.byHub.map((entrance) => [entrance.type, entrance.thisSession])).toEqual([
        ['hub', true],
        ['local', false],
      ])
      // the credential itself never leaves
      expect(JSON.stringify(answer.entrances)).not.toContain('digest')
    } finally {
      await db.dispose()
    }
  })

  it('says when they last came in at each door, a door that keeps no binding included', async () => {
    const db = await createTestContext('self-last-sign-in')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const campus = one<{ id: string }>(
              yield* runSql(sql`
                insert into auth_providers (tenant_id, code, type, name, enabled, sort_order)
                values (${f.tenant}, 'campus', 'campus', 'campus', true, 1) returning id`),
            ).id
            const attempt = (at: string, outcome: string) =>
              runSql(sql`
                insert into sign_in_events (tenant_id, occurred_at, provider_id, provider_type, provider_code, user_id, outcome)
                values (${f.tenant}, ${at}::timestamptz, ${campus}, 'campus', 'campus', ${f.lin}, ${outcome})`)
            yield* attempt('2026-09-01T08:00:00Z', 'success')
            yield* attempt('2026-09-02T09:30:00Z', 'success')
            // a refusal afterwards is not a sign-in
            yield* attempt('2026-09-03T10:00:00Z', 'failure')
            const iam = yield* Iam
            return yield* iam.self.entrances(f.as(f.lin, f.linByHub))
          }),
        ),
      )
      const at = (type: string) => answer.find((entrance) => entrance.type === type)?.lastSignInAt
      expect(new Date(String(at('campus'))).toISOString()).toBe('2026-09-02T09:30:00.000Z')
      expect(at('hub')).toBeNull()
    } finally {
      await db.dispose()
    }
  })

  it('lets go of a bound account, and ends the sessions that came in through it', async () => {
    const db = await createTestContext('self-unbind')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            // one sign-in through each account Ada holds
            const signedIn = (door: string, type: string, binding: string, at: string) =>
              runSql(sql`
                insert into sign_in_events (tenant_id, occurred_at, provider_id, provider_type, provider_code, user_id, binding_id, outcome)
                values (${f.tenant}, ${at}::timestamptz, ${door}, ${type}, ${type}, ${f.ada}, ${binding}, 'success')`)
            yield* signedIn(f.hubDoor, 'hub', f.adaHub, '2026-09-01T08:00:00Z')
            yield* signedIn(f.local, 'local', f.adaPassword, '2026-09-02T08:00:00Z')
            const released = yield* iam.self.unbind(f.as(f.ada, f.adaByPassword), f.hubDoor)
            const listed = yield* iam.self.entrances(f.as(f.ada, f.adaByPassword))
            const sessions = yield* runSql<{ id: string }>(
              sql`select id from sessions where user_id = ${f.ada} order by id`,
            )
            const binding = yield* runSql<{ revoked: boolean; revoked_by: string | null }>(
              sql`select revoked_at is not null as revoked, revoked_by from user_auth_bindings where id = ${f.adaHub}`,
            )
            const audited = yield* runSql<{ action_code: string; actor_user_id: string }>(
              sql`select action_code, actor_user_id from audit_events where target_id = ${f.ada}`,
            )
            const again = yield* Effect.result(
              iam.self.unbind(f.as(f.ada, f.adaByPassword), f.hubDoor),
            )
            const password = yield* Effect.result(
              iam.self.unbind(f.as(f.ada, f.adaByPassword), f.local),
            )
            return {
              released,
              listed,
              sessions: sessions.rows.map((row) => row.id),
              binding: binding.rows[0]!,
              audited: audited.rows,
              again,
              password,
            }
          }),
        ),
      )
      // this session came in by password, so it goes on
      expect(answer.released).toEqual({ signedOut: false })
      expect(answer.sessions).toEqual([f.adaByPassword])
      expect(answer.binding).toEqual({ revoked: true, revoked_by: f.ada })
      expect(answer.audited).toEqual([
        { action_code: 'auth.identity.revoke', actor_user_id: f.ada },
      ])
      expect(tagOf(answer.again)).toBe('AUTH_BINDING_NOT_FOUND')
      expect(tagOf(answer.password)).toBe('AUTH_BINDING_UNSUPPORTED')
      // the let-go account's sign-ins are not this way's any more; the password's are
      const last = (type: string) =>
        answer.listed.find((entrance) => entrance.type === type)?.lastSignInAt
      expect(last('hub')).toBeNull()
      expect(new Date(String(last('local'))).toISOString()).toBe('2026-09-02T08:00:00.000Z')
    } finally {
      await db.dispose()
    }
  })

  it('ends the very session it was asked from, when that one came in through it', async () => {
    const db = await createTestContext('self-unbind-current')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.flatMap(Iam, (iam) => iam.self.unbind(f.as(f.ada, f.adaByHub), f.hubDoor)),
        ),
      )
      expect(answer).toEqual({ signedOut: true })
    } finally {
      await db.dispose()
    }
  })

  it('keeps the last way in, and counts a door that finds them by their identifier', async () => {
    const db = await createTestContext('self-last-way-in')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const lin = f.as(f.lin, f.linByHub)
            const listed = yield* iam.self.entrances(lin)
            const refused = yield* Effect.result(iam.self.unbind(lin, f.hubDoor))
            const standing = yield* runSql<{ live: number }>(
              sql`select count(*)::int as live from user_auth_bindings
                   where user_id = ${f.lin} and revoked_at is null`,
            )
            // a door that goes by the person identifier Lin has is a way in
            yield* runSql(sql`
              insert into auth_providers (tenant_id, code, type, name, enabled, sort_order)
              values (${f.tenant}, 'campus', 'campus', 'Campus', true, 1)`)
            const relisted = yield* iam.self.entrances(lin)
            const released = yield* iam.self.unbind(lin, f.hubDoor)
            const afterwards = yield* iam.self.entrances(lin)
            const systemListed = yield* iam.self.entrances(f.as(f.admin, f.adaByPassword))
            const system = yield* iam.self.unbind(f.as(f.admin, f.adaByPassword), f.hubDoor)
            const systemLeft = yield* runSql<{ door: string }>(
              sql`select auth_provider_id as door from user_auth_bindings
                   where user_id = ${f.admin} and revoked_at is null`,
            )
            return {
              listed,
              refused,
              standing: standing.rows[0]!.live,
              relisted,
              released,
              afterwards,
              systemListed,
              system,
              systemLeft: systemLeft.rows.map((row) => row.door),
            }
          }),
        ),
      )
      expect(answer.listed.find((entrance) => entrance.type === 'hub')?.unbindable).toBe(false)
      expect(tagOf(answer.refused)).toBe('AUTH_LAST_WAY_IN')
      // refused on the state it would have left, and nothing of it stayed
      expect(answer.standing).toBe(1)
      expect(answer.relisted.find((entrance) => entrance.type === 'hub')?.unbindable).toBe(true)
      expect(answer.released).toEqual({ signedOut: true })
      // bound, nothing to begin; let go, the way to bind again is offered
      expect(answer.relisted.find((entrance) => entrance.type === 'hub')?.bindHref).toBeNull()
      expect(answer.afterwards.find((entrance) => entrance.type === 'hub')?.bindHref).toBe(
        '/auth/hub/hub/start?intent=bind',
      )
      // the system account lets its hub account go like anyone; its password stays
      expect(answer.systemListed.find((entrance) => entrance.type === 'hub')?.unbindable).toBe(true)
      expect(answer.system).toEqual({ signedOut: false })
      expect(answer.systemLeft).toEqual([f.local])
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('the reader’s own devices and sign-ins', () => {
  it('lists their own sign-ins newest first, a page at a time, and marks the one in hand', async () => {
    const db = await createTestContext('self-sign-ins')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const attempt = (
              userId: string,
              at: string,
              outcome: string,
              sessionId: string | null,
            ) =>
              runSql(sql`
                insert into sign_in_events (tenant_id, occurred_at, provider_id, provider_type, provider_code, user_id, outcome, session_id, client_ip, user_agent)
                values (${f.tenant}, ${at}::timestamptz, ${f.local}, 'local', 'local', ${userId}, ${outcome}, ${sessionId}, '203.0.113.7', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0 Safari/537.36')`)
            yield* attempt(f.ada, '2026-09-01T08:00:00Z', 'success', f.adaByPassword)
            yield* attempt(f.ada, '2026-09-02T08:00:00Z', 'failure', null)
            yield* attempt(f.ada, '2026-09-03T08:00:00Z', 'success', f.adaByHub)
            // somebody else's is never the reader's
            yield* attempt(f.lin, '2026-09-04T08:00:00Z', 'success', f.linByHub)
            const iam = yield* Iam
            const me = f.as(f.ada, f.adaByPassword)
            const first = yield* iam.selfSecurity.signIns(me, {}, { page: 1, pageSize: 2 })
            const rest = yield* iam.selfSecurity.signIns(me, {}, { page: 2, pageSize: 2 })
            const refused = yield* iam.selfSecurity.signIns(
              me,
              { outcome: 'failure' },
              { page: 1, pageSize: 10 },
            )
            const early = yield* iam.selfSecurity.signIns(
              me,
              { from: '2026-09-01T00:00:00Z', to: '2026-09-03T00:00:00Z' },
              { page: 1, pageSize: 10 },
            )
            return { first, rest, refused, early }
          }),
        ),
      )
      const at = (rows: readonly { occurredAt: Date | string }[]) =>
        rows.map((row) => new Date(String(row.occurredAt)).toISOString().slice(0, 10))
      // numbered: how many in all, and the page each one is on
      expect(answer.first.total).toBe(3)
      expect(at(answer.first.rows)).toEqual(['2026-09-03', '2026-09-02'])
      expect(at(answer.rest.rows)).toEqual(['2026-09-01'])
      expect(answer.first.rows.map((row) => row.outcome)).toEqual(['success', 'failure'])
      expect(answer.rest.rows[0]!.sessionId).toBe(f.adaByPassword)
      expect(answer.first.rows[0]!.providerName).toBe('local')
      // asked for only the refused ones, only those come back
      expect(answer.refused.rows.map((row) => row.outcome)).toEqual(['failure'])
      // within a stretch of days: from its first instant, up to its last
      expect(at(answer.early.rows)).toEqual(['2026-09-02', '2026-09-01'])
    } finally {
      await db.dispose()
    }
  })

  it('ends one other device, never the one in hand nor anybody else’s, and records it', async () => {
    const db = await createTestContext('self-sessions')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const me = f.as(f.ada, f.adaByPassword)
            const before = yield* iam.selfSecurity.sessions(me, { limit: 20 })
            const inHand = yield* Effect.result(iam.selfSecurity.endSession(me, f.adaByPassword))
            const elsewhere = yield* Effect.result(iam.selfSecurity.endSession(me, f.linByHub))
            yield* iam.selfSecurity.endSession(me, f.adaByHub)
            const after = yield* iam.selfSecurity.sessions(me, { limit: 20 })
            const lin = yield* iam.selfSecurity.sessions(f.as(f.lin, f.linByHub), { limit: 20 })
            const recorded = yield* runSql<{ details: { scope: string; ended: number } }>(sql`
              select details from audit_events
               where action_code = 'auth.session.revoke' and target_id = ${f.ada}`)
            return { before, inHand, elsewhere, after, lin, recorded: recorded.rows }
          }),
        ),
      )
      expect(answer.before.map((row) => row.id).sort()).toEqual(
        [f.adaByHub, f.adaByPassword].sort(),
      )
      expect(tagOf(answer.inHand)).toBe('AUTH_SESSION_NOT_FOUND')
      expect(tagOf(answer.elsewhere)).toBe('AUTH_SESSION_NOT_FOUND')
      expect(answer.after.map((row) => row.id)).toEqual([f.adaByPassword])
      expect(answer.lin.map((row) => row.id)).toEqual([f.linByHub])
      expect(answer.recorded.map((row) => row.details)).toEqual([{ scope: 'one', ended: 1 }])
    } finally {
      await db.dispose()
    }
  })

  it('ends every device but the one in hand at once, and says how many', async () => {
    const db = await createTestContext('self-sessions-all')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const me = f.as(f.ada, f.adaByPassword)
            const ended = yield* iam.selfSecurity.endOtherSessions(me)
            const again = yield* iam.selfSecurity.endOtherSessions(me)
            const left = yield* iam.selfSecurity.sessions(me, { limit: 20 })
            const recorded = yield* runSql<{ n: string }>(sql`
              select count(*)::text as n from audit_events where action_code = 'auth.session.revoke'`)
            return { ended, again, left, recorded: recorded.rows[0]!.n }
          }),
        ),
      )
      expect(answer.ended).toBe(1)
      // nothing left to end is not a failure, and not an event
      expect(answer.again).toBe(0)
      expect(answer.left.map((row) => row.id)).toEqual([f.adaByPassword])
      expect(answer.recorded).toBe('1')
    } finally {
      await db.dispose()
    }
  })
})
