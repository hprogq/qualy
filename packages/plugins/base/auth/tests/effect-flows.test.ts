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
import { captchaLayer } from '@qualy/plugin-captcha/testkit'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import { HttpServerRequest } from 'effect/unstable/http'
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
import { HARD_LIMITS } from '../src/server/limiter.ts'
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
      Layer.provideMerge(captchaLayer),
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
  effect: Effect.Effect<A, E, Iam | LoginSessions | AnonymousTenantResolver | Orm | Secrets>,
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
    expect(publicOriginFrom('https://qualy.example.edu:8443')).toBe(
      'https://qualy.example.edu:8443',
    )
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
    expect(ok(await configured({ NODE_ENV: 'production', QUALY_PUBLIC_URL: PUBLIC_URL }))).toBe(
      PUBLIC_URL,
    )
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
    // a deep link with its query survives the round trip whole
    const deep = `/assessment/batches?${'q=1&'.repeat(200)}`
    expect(safeReturnPath(deep)).toBe(deep)
    for (const wrong of [
      undefined,
      'https://elsewhere.example/',
      '//elsewhere.example/',
      'javascript:alert(1)',
      '/\\elsewhere.example/',
      `/${'x'.repeat(2048)}`,
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
            const callback = yield* sessions.callbackUrl(provider)
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
      await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const sessions = yield* LoginSessions
            const door = yield* resolve('campus')
            const other = yield* resolve('campus-two')
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
            const strayed = yield* Effect.result(sessions.consumeFlow({ provider: other, state }))
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
            const door = yield* resolve('campus')
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
            const door = yield* resolve('campus')
            const other = yield* resolve('campus-two')
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
          const door = yield* resolve('campus')
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

describe.runIf(postgresAvailable)('what a driver keeps through a redirect', () => {
  it('is made from the state it is issued under, and sealed before it is stored', async () => {
    const db = await createTestContext('flows-factory')
    try {
      await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const sessions = yield* LoginSessions
            const door = yield* resolve('campus')
            let seen: string | undefined
            const started = yield* sessions.startFlow({
              provider: door,
              purpose: 'login',
              // the address a CAS server is told to come back to carries the
              // state itself, so it can only be written once the state exists
              payload: (state) => {
                seen = Redacted.value(state)
                return Redacted.make(`https://qualy.example.edu/cb?flow=${seen}`)
              },
            })
            const stored = yield* runSql<{ payload_sealed: string }>(
              sql`select payload_sealed from auth_flows where id = ${started.flowId}`,
            )
            const taken = yield* sessions.consumeFlow({
              provider: door,
              state: Redacted.value(started.state),
            })
            return { started, seen, stored: stored.rows[0]!, taken }
          }),
        ),
      )
      const state = Redacted.value(answer.started.state)
      expect(answer.seen).toBe(state)
      expect(answer.stored.payload_sealed).not.toContain(state)
      expect(Redacted.value(answer.taken.payload!)).toBe(
        `https://qualy.example.edu/cb?flow=${state}`,
      )
    } finally {
      await db.dispose()
    }
  })

  it('is started only so often from one place', async () => {
    const { limit } = HARD_LIMITS.flowStartByAddress
    const db = await createTestContext('flows-throttle')
    try {
      await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const sessions = yield* LoginSessions
            const door = yield* resolve('campus')
            const outcomes: (string | undefined)[] = []
            for (let started = 0; started <= limit; started += 1) {
              outcomes.push(
                tagOf(
                  yield* Effect.result(sessions.startFlow({ provider: door, purpose: 'login' })),
                ),
              )
            }
            const rows = yield* runSql<{ count: number }>(
              sql`select count(*)::int as count from auth_flows`,
            )
            return { outcomes, rows: rows.rows[0]!.count }
          }),
        ),
      )
      expect(answer.outcomes.slice(0, limit)).toEqual(
        Array.from({ length: limit }, () => undefined),
      )
      expect(answer.outcomes[limit]).toBe('TOO_MANY_ATTEMPTS')
      // the one refused cost no row
      expect(answer.rows).toBe(limit)
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('an account bound from the other side', () => {
  const serving = (url: string, id: string) =>
    Effect.runPromise(
      runSql(sql`update auth_providers set enabled = true where id = ${id}`).pipe(
        Effect.provide(databaseFor(url, { migrations: 'off', entities: authClosure })),
      ),
    )

  /** a bind flow for the seeded person, taken up the way a callback takes it */
  const bindFlow = (door: ResolvedProvider, userId: string, sessionId: string) =>
    Effect.gen(function* () {
      const sessions = yield* LoginSessions
      const started = yield* sessions.startFlow({
        provider: door,
        purpose: 'bind',
        binding: { userId, sessionId },
      })
      return yield* sessions.consumeFlow({ provider: door, state: Redacted.value(started.state) })
    })

  it('binds the person the flow began with, once, and never a subject somebody holds', async () => {
    const db = await createTestContext('flows-bind-subject')
    try {
      const f = await seed(db.url)
      await serving(db.url, f.door.id)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const sessions = yield* LoginSessions
            const door = yield* resolve('campus')
            const login = yield* sessions.startFlow({ provider: door, purpose: 'login' })
            const loginTaken = yield* sessions.consumeFlow({
              provider: door,
              state: Redacted.value(login.state),
            })
            // a sign-in is not a bind, whatever the callback carried
            const notBind = yield* Effect.result(
              sessions.bindSubject({ provider: door, flow: loginTaken, subject: '12345' }),
            )
            // a flow that was never taken up is not one either
            const forged = yield* Effect.result(
              sessions.bindSubject({
                provider: door,
                flow: {
                  flowId: '99999999-9999-4999-8999-999999999999',
                  purpose: 'bind',
                  userId: f.person,
                  sessionId: f.session,
                },
                subject: '12345',
              }),
            )
            const bound = yield* sessions.bindSubject({
              provider: door,
              flow: yield* bindFlow(door, f.person, f.session),
              subject: '12345',
              displayLabel: 'ada-lovelace',
            })
            const again = yield* Effect.result(
              sessions.bindSubject({
                provider: door,
                flow: yield* bindFlow(door, f.person, f.session),
                subject: '67890',
              }),
            )
            const found = yield* sessions.findBindingBySubject({
              tenantId: f.tenant,
              providerId: f.door.id,
              subject: '12345',
            })
            const audited = yield* runSql<{ action: string }>(
              sql`select action_code as action from audit_events where target_id = ${f.person}`,
            )
            return { notBind, forged, bound, again, found, audited: audited.rows }
          }),
        ),
      )
      expect(reasonOf(answer.notBind)).toBe('not-a-bind')
      expect(reasonOf(answer.forged)).toBe('not-a-bind')
      expect(answer.found).toMatchObject({ id: answer.bound.bindingId, userId: expect.any(String) })
      expect(reasonOf(answer.again)).toBe('already-bound')
      expect(answer.audited.map((row) => row.action)).toContain('auth.identity.bind')
    } finally {
      await db.dispose()
    }
  })

  it('refuses a subject held by somebody else, and a door that stopped serving', async () => {
    const db = await createTestContext('flows-bind-refused')
    try {
      const f = await seed(db.url)
      await serving(db.url, f.door.id)
      await Effect.runPromise(
        runSql(sql`
          insert into user_auth_bindings (tenant_id, user_id, auth_provider_id, subject)
          values (${f.tenant}, ${f.admin}, ${f.door.id}, 'taken')`).pipe(
          Effect.provide(databaseFor(db.url, { migrations: 'off', entities: authClosure })),
        ),
      )
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const sessions = yield* LoginSessions
            const door = yield* resolve('campus')
            const taken = yield* Effect.result(
              sessions.bindSubject({
                provider: door,
                flow: yield* bindFlow(door, f.person, f.session),
                subject: 'taken',
              }),
            )
            const flow = yield* bindFlow(door, f.person, f.session)
            yield* runSql(sql`update auth_providers set enabled = false where id = ${f.door.id}`)
            const closed = yield* Effect.result(
              sessions.bindSubject({ provider: door, flow, subject: 'fresh' }),
            )
            return { taken, closed }
          }),
        ),
      )
      expect(reasonOf(answer.taken)).toBe('subject-taken')
      expect(reasonOf(answer.closed)).toBe('provider-unavailable')
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('what a session keeps from the other side', () => {
  it('is written with the session, sealed under it, and goes with it', async () => {
    const db = await createTestContext('flows-grants')
    try {
      const f = await seed(db.url)
      const answer = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const sessions = yield* LoginSessions
            const secrets = yield* Secrets
            yield* sessions.completeLogin({
              tenantId: f.tenant,
              providerId: f.door.id,
              userId: f.person,
              grants: [{ kind: 'upstream-session', state: Redacted.make('TGT-upstream-value') }],
            })
            const rows = yield* runSql<{
              session_id: string
              auth_provider_id: string
              kind: string
              state_sealed: string
            }>(
              sql`select session_id, auth_provider_id, kind, state_sealed from session_auth_grants`,
            )
            const grant = rows.rows[0]!
            const opened = yield* secrets.open(
              {
                tenantId: f.tenant,
                ownerKind: 'session-grant',
                ownerId: grant.session_id,
                key: `${f.door.id}:upstream-session:v1`,
              },
              grant.state_sealed,
            )
            // lifted onto another session, it does not open
            const lifted = yield* Effect.result(
              secrets.open(
                {
                  tenantId: f.tenant,
                  ownerKind: 'session-grant',
                  ownerId: f.session,
                  key: `${f.door.id}:upstream-session:v1`,
                },
                grant.state_sealed,
              ),
            )
            yield* runSql(sql`delete from sessions where id = ${grant.session_id}`)
            const left = yield* runSql<{ count: number }>(
              sql`select count(*)::int as count from session_auth_grants`,
            )
            return { rows: rows.rows, opened, lifted, left: left.rows[0]!.count }
          }).pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              HttpServerRequest.fromWeb(
                new Request('http://localhost/api/auth/campus/campus/callback'),
              ),
            ),
          ),
        ),
      )
      expect(answer.rows).toHaveLength(1)
      expect(answer.rows[0]).toMatchObject({
        auth_provider_id: expect.any(String),
        kind: 'upstream-session',
      })
      expect(answer.rows[0]!.state_sealed).not.toContain('TGT-upstream-value')
      expect(Redacted.value(answer.opened)).toBe('TGT-upstream-value')
      expect(tagOf(answer.lifted)).toBe('SecretUnreadable')
      expect(answer.left).toBe(0)
    } finally {
      await db.dispose()
    }
  })
})

/** the type the driver-facing surface hands over, kept honest here */
const _shape: (provider: ResolvedProvider) => string = (provider) => provider.code
void _shape
