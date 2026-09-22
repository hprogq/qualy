import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as authPermissions } from '@qualy/plugin-auth/permissions'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import { Cause, ConfigProvider, Effect, Exit, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { type Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import {
  LoginSessions,
  loginDriversLayer,
  registerLoginDriver,
  type LoginDriver,
  type ResolvedProvider,
} from '@qualy/auth-contract/login'
import { driver as localDriver } from '@qualy/plugin-auth-local'
import { userActions } from '../src/actions.ts'
import {
  AuthConfig,
  config as authConfigLayer,
  DEVELOPMENT_PUBLIC_URL,
  publicOriginFrom,
  PUBLIC_URL_INSECURE,
  PUBLIC_URL_MALFORMED,
} from '../src/server/auth-config.ts'
import { Iam, serviceLayer as authLayer } from '../src/server/index.ts'
import { AnonymousTenantResolver } from '../src/server/tenancy.ts'
import { safeReturnPath } from '../src/server/flows.ts'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../src/constants.ts'
import { authClosure } from './support/closure.ts'

// A sign-in that leaves this application and comes back.
//
// Three facts carry it: which tenant an anonymous visitor belongs to, what
// address the outside world reaches this deployment at, and the one-shot row
// that ties a departure to a return. The first two are resolvers because one
// day a host decides them; the third is the whole of what a redirect through
// somebody else's server may be trusted about.

const literal = (value: string) => ({ kind: 'literal' as const, value })

const campus: LoginDriver = {
  type: 'campus',
  presentation: { mode: 'redirect', href: ({ code }) => `/api/auth/campus/${code}/start` },
  provisioning: {
    mode: 'tenant-managed',
    entrance: { label: literal('Campus'), fields: [] },
  },
  resolution: { mode: 'binding-subject' },
  binding: { mode: 'self' },
  callback: ({ code }) => `/api/auth/campus/${code}/callback`,
}

const PUBLIC_URL = 'https://qualy.example.edu'

const stack = (url: string, publicUrl: string | null) =>
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
      Layer.provideMerge(secretsLayer),
      Layer.provideMerge(
        Layer.mergeAll(
          databaseFor(url, { entities: authClosure }),
          Layer.mergeAll(registerLoginDriver(localDriver), registerLoginDriver(campus)).pipe(
            Layer.provideMerge(loginDriversLayer),
          ),
          uiLayer,
          Layer.succeed(
            AuthConfig,
            AuthConfig.of({
              defaultTenantSlug: 'default',
              sessionTtlSeconds: 3600,
              secureCookies: false,
              sessionCookieName: 'qualy_session',
              ...(publicUrl === null ? {} : { publicUrl }),
            }),
          ),
        ),
      ),
    ),
    { catalog: compileCatalog([{ owner: 'auth', permissions: authPermissions }]) },
  )

const run = <A, E>(
  url: string,
  effect: Effect.Effect<A, E, Iam | LoginSessions | AnonymousTenantResolver | Orm>,
  publicUrl: string | null = PUBLIC_URL,
) => Effect.runPromiseExit(Effect.provide(effect, stack(url, publicUrl)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${Cause.pretty(exit.cause)}`)
}

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

const reasonOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { reason?: string }).reason : undefined

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** a tenant with the platform door, one campus door in service, and a person */
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
      const admin = one<{ id: string }>(
        yield* runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email)
          values (${tenant}, 'Admin', ${system}, ${root}, 'root@school.edu') returning id`),
      ).id
      const person = one<{ id: string }>(
        yield* runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email)
          values (${tenant}, 'Ada', ${staff}, ${root}, 'ada@school.edu') returning id`),
      ).id
      const role = one<{ id: string }>(
        yield* runSql(sql`
          insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
          values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
          returning id`),
      ).id
      yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id) values (${tenant}, ${admin}, ${role})`)
      const local = one<{ id: string; version: number }>(
        yield* runSql(sql`
          insert into auth_providers (tenant_id, code, type, name, is_system, sort_order)
          values (${tenant}, 'local', 'local', 'Local', true, 0) returning id, version`),
      )
      yield* runSql(sql`
        insert into user_auth_bindings (tenant_id, user_id, auth_provider_id, subject, credential_hash)
        values (${tenant}, ${admin}, ${local.id}, null, 'digest')`)
      const door = one<{ id: string; version: number }>(
        yield* runSql(sql`
          insert into auth_providers (tenant_id, code, type, name, sort_order)
          values (${tenant}, 'campus', 'campus', 'Campus', 1) returning id, version`),
      )
      const other = one<{ id: string; version: number }>(
        yield* runSql(sql`
          insert into auth_providers (tenant_id, code, type, name, sort_order)
          values (${tenant}, 'campus-two', 'campus', 'Campus two', 2) returning id, version`),
      )
      const session = one<{ id: string }>(
        yield* runSql(sql`
          insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
          values (${tenant}, ${person}, ${local.id}, repeat('b', 64), now() + interval '1 day')
          returning id`),
      ).id
      const as: Principal = { tenantId: tenant, userId: admin, sessionId: 's' }
      return { tenant, admin, person, local, door, other, session, as }
    }).pipe(Effect.provide(databaseFor(url, { migrations: 'off', entities: authClosure }))),
  )

/** the entrance as a driver receives it, for a code the seed created */
const resolve = (code: string) =>
  Effect.flatMap(LoginSessions, (sessions) =>
    sessions.resolveProvider({ providerCode: code, expectedType: 'campus' }),
  ).pipe(Effect.map((found) => found!))

describe('the address this deployment is reached at', () => {
  it('is an origin and nothing else', () => {
    expect(publicOriginFrom('https://qualy.example.edu')).toBe('https://qualy.example.edu')
    expect(publicOriginFrom(' https://qualy.example.edu/ ')).toBe('https://qualy.example.edu')
    expect(publicOriginFrom('https://qualy.example.edu:8443')).toBe('https://qualy.example.edu:8443')
    // everything that would move, or carry, what is appended to it
    for (const wrong of [
      'qualy.example.edu',
      'https://qualy.example.edu/qualy',
      'https://qualy.example.edu/?x=1',
      'https://qualy.example.edu/#a',
      'https://user:pw@qualy.example.edu',
      'ftp://qualy.example.edu',
      '',
    ]) {
      expect(publicOriginFrom(wrong), wrong).toBeUndefined()
    }
  })

  const configured = (env: Record<string, string>) =>
    Effect.runPromiseExit(
      Effect.flatMap(AuthConfig, (settings) => Effect.succeed(settings.publicUrl)).pipe(
        Effect.provide(
          authConfigLayer({}, { manifestDir: '/somewhere' }).pipe(
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
          ),
        ),
      ),
    )

  it('is the vite server in development, said out loud in production, and never wrong', async () => {
    expect(ok(await configured({}))).toBe(DEVELOPMENT_PUBLIC_URL)
    expect(ok(await configured({ NODE_ENV: 'production' }))).toBeUndefined()
    expect(
      ok(await configured({ NODE_ENV: 'production', QUALY_PUBLIC_URL: PUBLIC_URL })),
    ).toBe(PUBLIC_URL)
    const malformed = await configured({ QUALY_PUBLIC_URL: 'qualy.example.edu' })
    expect(Cause.pretty((malformed as Exit.Failure<unknown, unknown>).cause)).toContain(
      PUBLIC_URL_MALFORMED,
    )
    const insecure = await configured({
      NODE_ENV: 'production',
      QUALY_PUBLIC_URL: 'http://qualy.example.edu',
    })
    expect(Cause.pretty((insecure as Exit.Failure<unknown, unknown>).cause)).toContain(
      PUBLIC_URL_INSECURE,
    )
  })
})

describe('where somebody asked to be returned to', () => {
  it('is a path inside this application, or nothing', () => {
    expect(safeReturnPath('/assessment/batches?open=1')).toBe('/assessment/batches?open=1')
    for (const wrong of [
      undefined,
      'https://elsewhere.example/',
      '//elsewhere.example/',
      'javascript:alert(1)',
      `/${'x'.repeat(300)}`,
    ]) {
      expect(safeReturnPath(wrong), String(wrong)).toBeUndefined()
    }
  })
})

describe.runIf(postgresAvailable)('the tenant an anonymous visitor belongs to', () => {
  it('is the deployment’s own, and is nobody when it has lapsed', async () => {
    const db = await createTestContext('flows-tenancy')
    try {
      const f = await seed(db.url)
      const found = ok(
        await run(
          db.url,
          Effect.flatMap(AnonymousTenantResolver, (tenants) => tenants.resolve),
        ),
      )
      expect(found).toMatchObject({ id: f.tenant, slug: 'default' })
      await Effect.runPromise(
        runSql(sql`update tenants set enabled = false where id = ${f.tenant}`).pipe(
          Effect.provide(databaseFor(db.url, { migrations: 'off', entities: authClosure })),
        ),
      )
      const gone = await run(
        db.url,
        Effect.flatMap(AnonymousTenantResolver, (tenants) => tenants.resolve),
      )
      expect(Cause.pretty((gone as Exit.Failure<unknown, unknown>).cause)).toContain(
        'TenantUnavailable',
      )
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('an entrance that sends people away', () => {
  it('is not ready, and cannot be put in service, until this deployment has an address', async () => {
    const db = await createTestContext('flows-origin')
    try {
      const f = await seed(db.url)
      const without = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const detail = yield* iam.providers.detail(f.tenant, f.door.id)
            const refused = yield* Effect.result(
              iam.providers.setStatus(f.tenant, f.door.id, 'active', f.door.version, f.as),
            )
            const resolved = yield* resolve('campus')
            return { detail, refused, resolved }
          }),
          null,
        ),
      )
      expect(without.detail.provider.setup).toBe('incomplete')
      expect(without.detail.missing).toEqual([{ kind: 'public-origin' }])
      expect(without.detail.callbackUrl).toBeNull()
      expect(tagOf(without.refused)).toBe('AUTH_PROVIDER_CONFIG_INCOMPLETE')
      expect(without.resolved).toBeUndefined()

      const with_ = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const detail = yield* iam.providers.detail(f.tenant, f.door.id)
            const version = yield* iam.providers.setStatus(
              f.tenant,
              f.door.id,
              'active',
              f.door.version,
              f.as,
            )
            const sessions = yield* LoginSessions
            const provider = yield* resolve('campus')
            const callback = yield* sessions.callbackUrl(provider!)
            return { detail, version, callback: callback.toString() }
          }),
        ),
      )
      expect(with_.detail.provider.setup).toBe('complete')
      expect(with_.detail.callbackUrl).toBe(`${PUBLIC_URL}/api/auth/campus/campus/callback`)
      expect(with_.callback).toBe(`${PUBLIC_URL}/api/auth/campus/campus/callback`)
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('one redirect through somebody else’s server', () => {
  it('is taken up once, by the entrance that started it, and never again', async () => {
    const db = await createTestContext('flows-consume')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const sessions = yield* LoginSessions
            const door = (yield* resolve('campus'))!
            const other = (yield* resolve('campus-two'))!
            const started = yield* sessions.startFlow({
              provider: door,
              purpose: 'login',
              returnPath: '/assessment/batches',
              payload: Redacted.make('{"verifier":"v"}'),
            })
            const state = Redacted.value(started.state)
            const stored = yield* runSql<{ state_hash: string; payload_sealed: string }>(
              sql`select state_hash, payload_sealed from auth_flows where id = ${started.flowId}`,
            )
            // the wrong entrance burns it without taking it up
            const strayed = yield* Effect.result(
              sessions.consumeFlow({ provider: other, state }),
            )
            const afterStray = yield* Effect.result(sessions.consumeFlow({ provider: door, state }))

            const again = yield* sessions.startFlow({
              provider: door,
              purpose: 'login',
              returnPath: 'https://elsewhere.example/',
              payload: Redacted.make('{"verifier":"w"}'),
            })
            const taken = yield* sessions.consumeFlow({
              provider: door,
              state: Redacted.value(again.state),
            })
            const replayed = yield* Effect.result(
              sessions.consumeFlow({ provider: door, state: Redacted.value(again.state) }),
            )
            const unknown = yield* Effect.result(
              sessions.consumeFlow({ provider: door, state: 'nobody-issued-this' }),
            )

            const stale = yield* sessions.startFlow({ provider: door, purpose: 'login' })
            yield* runSql(
              sql`update auth_flows set expires_at = now() - interval '1 minute' where id = ${stale.flowId}`,
            )
            const expired = yield* Effect.result(
              sessions.consumeFlow({ provider: door, state: Redacted.value(stale.state) }),
            )
            return {
              started,
              stored: stored.rows[0]!,
              strayed,
              afterStray,
              taken,
              replayed,
              unknown,
              expired,
            }
          }),
        ),
      )
      // the state is a secret, and the payload is not readable in the row
      expect(answer.stored.state_hash).not.toBe(Redacted.value(answer.started.state))
      expect(answer.stored.state_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(answer.stored.payload_sealed).not.toContain('verifier')

      expect(reasonOf(answer.strayed)).toBe('provider-mismatch')
      // and it was spent doing so
      expect(reasonOf(answer.afterStray)).toBe('consumed')

      expect(answer.taken.purpose).toBe('login')
      expect(Redacted.value(answer.taken.payload!)).toBe('{"verifier":"w"}')
      // a return path that leaves the application is dropped at the start
      expect(answer.taken.returnPath).toBeUndefined()
      expect(reasonOf(answer.replayed)).toBe('consumed')
      expect(reasonOf(answer.unknown)).toBe('unknown')
      expect(reasonOf(answer.expired)).toBe('expired')
    } finally {
      await db.dispose()
    }
  })

  it('binds an account for the person who began it, in the session they began it in', async () => {
    const db = await createTestContext('flows-bind')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const sessions = yield* LoginSessions
            const door = (yield* resolve('campus'))!
            const nowhere = yield* Effect.result(
              sessions.startFlow({
                provider: door,
                purpose: 'bind',
                // a session nobody has: a bind may only be pinned to a live one
                binding: { userId: f.person, sessionId: '99999999-9999-4999-8999-999999999999' },
              }),
            )
            const started = yield* sessions.startFlow({
              provider: door,
              purpose: 'bind',
              binding: { userId: f.person, sessionId: f.session },
            })
            const taken = yield* sessions.consumeFlow({
              provider: door,
              state: Redacted.value(started.state),
            })

            // a bind whose session ended on the way is not a bind
            const second = yield* sessions.startFlow({
              provider: door,
              purpose: 'bind',
              binding: { userId: f.person, sessionId: f.session },
            })
            yield* runSql(sql`delete from sessions where id = ${f.session}`)
            const orphaned = yield* Effect.result(
              sessions.consumeFlow({ provider: door, state: Redacted.value(second.state) }),
            )
            const left = yield* runSql<{ count: number }>(
              sql`select count(*)::int as count from auth_flows where session_id = ${f.session}`,
            )
            return { nowhere, taken, orphaned, left: left.rows[0]!.count }
          }),
        ),
      )
      expect(reasonOf(answer.nowhere)).toBe('session-mismatch')
      expect(answer.taken).toMatchObject({ purpose: 'bind', userId: expect.any(String) })
      // the session went, and so did the flows that belonged to it
      expect(reasonOf(answer.orphaned)).toBe('unknown')
      expect(answer.left).toBe(0)
    } finally {
      await db.dispose()
    }
  })

  it('ends when the entrance or the person it belongs to does', async () => {
    const db = await createTestContext('flows-ended')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const iam = yield* Iam
            const sessions = yield* LoginSessions
            const door = (yield* resolve('campus'))!
            const other = (yield* resolve('campus-two'))!
            const ofDoor = yield* sessions.startFlow({ provider: door, purpose: 'login' })
            const ofPerson = yield* sessions.startFlow({
              provider: other,
              purpose: 'bind',
              binding: { userId: f.person, sessionId: f.session },
            })
            yield* iam.providers.remove(f.tenant, f.door.id, f.door.version, f.as)
            const doorGone = yield* Effect.result(
              sessions.consumeFlow({ provider: door, state: Redacted.value(ofDoor.state) }),
            )
            yield* iam.users.remove(f.tenant, f.person, 1, f.as)
            const personGone = yield* Effect.result(
              sessions.consumeFlow({ provider: other, state: Redacted.value(ofPerson.state) }),
            )
            const rows = yield* runSql<{ id: string; consumed: boolean }>(
              sql`select id, consumed_at is not null as consumed from auth_flows`,
            )
            return { doorGone, personGone, rows: rows.rows }
          }),
        ),
      )
      // a door is only soft-deleted, so its open flows are burned by name
      expect(reasonOf(answer.doorGone)).toBe('consumed')
      // a person's flows are pinned to a session, and sessions are deleted
      // with the person: the row is gone rather than spent
      expect(reasonOf(answer.personGone)).toBe('unknown')
      expect(answer.rows.filter((row) => !row.consumed)).toEqual([])
    } finally {
      await db.dispose()
    }
  })

  it('will not open a payload that was moved onto another flow', async () => {
    const db = await createTestContext('flows-payload')
    try {
      const f = await seed(db.url)
      const moved = await run(
        db.url,
        Effect.gen(function* () {
          const sessions = yield* LoginSessions
          const door = (yield* resolve('campus'))!
          const first = yield* sessions.startFlow({
            provider: door,
            purpose: 'login',
            payload: Redacted.make('{"verifier":"v"}'),
          })
          const second = yield* sessions.startFlow({ provider: door, purpose: 'login' })
          yield* runSql(sql`
            update auth_flows set payload_sealed =
              (select payload_sealed from auth_flows where id = ${first.flowId})
             where id = ${second.flowId}`)
          return yield* sessions.consumeFlow({
            provider: door,
            state: Redacted.value(second.state),
          })
        }),
      )
      // a defect rather than a refusal: nothing a sign-in can answer
      expect(Exit.isFailure(moved)).toBe(true)
      expect(Cause.pretty((moved as Exit.Failure<unknown, unknown>).cause)).toContain(
        'SecretUnreadable',
      )
      void f
    } finally {
      await db.dispose()
    }
  })
})

/** the type the driver-facing surface hands over, kept honest here */
const _shape: (provider: ResolvedProvider) => string = (provider) => provider.code
void _shape
