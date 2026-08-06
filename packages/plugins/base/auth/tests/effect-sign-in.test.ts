import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'drizzle-orm'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, databaseFor, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Database } from '@qualy/plugin-database/server'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { LoginDrivers } from '@qualy/auth-contract/login'
import { hashPassword } from '@qualy/plugin-auth-local/password'
import { hashSessionToken } from '../src/session.ts'
import { authLocalApiHandlers } from '@qualy/plugin-auth-local/server'
import { authLocalApiGroup } from '@qualy/plugin-auth-local/api'
import { driver as localDriver } from '@qualy/plugin-auth-local/login-driver'
import { sessionApiGroup } from '../src/api.ts'
import { sessionApiHandlers } from '../src/server/index.ts'
import { AuthConfig, layer as signInLayer } from '../src/server/sign-in.ts'
import { layer as sessionLayer, sessionCookieName } from '../src/server/session.ts'
import { authClosure } from './support/closure.ts'

// The whole sign-in cycle, over a real server: no method, a password, the
// session it creates, and signing out again.
//
// The cases worth stating are the ones a screen would otherwise get wrong. A
// provider whose driver is not loaded must not be offered, or it renders a
// form nothing can answer. Every credential failure must look the same, or the
// answer tells a stranger which accounts exist. Signing out must succeed when
// there was nothing to sign out of, or the client has to handle a failure that
// means the thing it asked for is already true.

const port = 3195
const base = `http://127.0.0.1:${port}${QUALY_API_PREFIX}`

const api = HttpApi.make(QUALY_API_ID)
  .add(sessionApiGroup)
  .add(authLocalApiGroup)
  .prefix(QUALY_API_PREFIX)

const password = 'correct horse battery staple'

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>

/** one tenant with two providers: one whose driver is loaded, one whose is not */
const seed = Effect.fn('seed')(function* (hash: string) {
  const database = yield* Database
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* database.execute(
      sql`insert into tenants (slug, name) values ('default','Default') returning id`,
    ),
  ).id
  const orgType = one<{ id: string }>(
    yield* database.execute(
      sql`insert into org_types (tenant_id, code, name) values (${tenant},'u','U') returning id`,
    ),
  ).id
  const node = one<{ id: string }>(
    yield* database.execute(sql`
      insert into org_nodes (tenant_id, org_type_id, name, code, path, depth)
      values (${tenant}, ${orgType}, 'Root', 'root', 'r', 0) returning id`),
  ).id
  const userType = one<{ id: string }>(
    yield* database.execute(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
      values (${tenant},'staff','Staff', true, 'unrestricted') returning id`),
  ).id
  // a type that admits no password, to prove the check is about the type
  // rather than about whether a credential was stored
  const ssoOnly = one<{ id: string }>(
    yield* database.execute(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
      values (${tenant},'sso','Sso', false, 'unrestricted') returning id`),
  ).id
  const user = one<{ id: string }>(
    yield* database.execute(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Ada', ${userType}, ${node}) returning id`),
  ).id
  const other = one<{ id: string }>(
    yield* database.execute(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Grace', ${ssoOnly}, ${node}) returning id`),
  ).id
  const provider = one<{ id: string }>(
    yield* database.execute(sql`
      insert into auth_providers (tenant_id, code, type, name, enabled, sort_order)
      values (${tenant}, 'password', 'local', 'Password', true, 0) returning id`),
  ).id
  // enabled, but its driver is not in this assembly's catalog
  yield* database.execute(sql`
    insert into auth_providers (tenant_id, code, type, name, enabled, sort_order)
    values (${tenant}, 'campus', 'cas', 'Campus', true, 1)`)
  const identity = (userId: string, identifier: string) =>
    database.execute(sql`
      insert into user_identities (tenant_id, user_id, auth_provider_id, identifier, credential_hash)
      values (${tenant}, ${userId}, ${provider}, ${identifier}, ${hash})`)
  yield* identity(user, 'ada')
  yield* identity(other, 'grace')
  return { tenant, user }
})

let userId: string

beforeAll(async () => {
  if (!postgresAvailable) return
  db = await createTestContext('effect-sign-in')
  const infra = databaseFor(db.url, { entities: authClosure })
  const authConfig = Layer.succeed(
    AuthConfig,
    AuthConfig.of({
      defaultTenantSlug: 'default',
      sessionTtlSeconds: 3600,
      secureCookies: false,
    }),
  )
  // only the local driver is in the catalog, so the cas provider row has
  // nothing to present it
  const signIn = signInLayer.pipe(
    Layer.provide(Layer.mergeAll(infra, authConfig, Layer.succeed(LoginDrivers, [localDriver]))),
  )
  const handlers = Layer.mergeAll(sessionApiHandlers, authLocalApiHandlers).pipe(
    Layer.provide(sessionLayer.pipe(Layer.provide(Layer.mergeAll(infra, authConfig)))),
  )
  // the service layers go in at the application level, the way the host wires
  // them: a handler's requirement is per-request, so it travels past the
  // handler layer and is satisfied where the whole api is assembled
  const application = HttpRouter.serve(
    HttpApiBuilder.layer(api).pipe(Layer.provide(handlers)),
  ).pipe(
    Layer.provide(signIn),
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provide(infra),
  )

  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
  const hash = await hashPassword(password)
  const seeded = await Effect.runPromise(seed(hash).pipe(Effect.provide(infra)))
  userId = seeded.user
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope, Exit.void))
  await db.dispose()
})

const probeInfra = () => databaseFor(db.url, { migrations: 'off', entities: authClosure })

const login = (body: { identifier: string; password: string }, code = 'password') =>
  fetch(`${base}/auth/local/${code}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const cookieFrom = (response: Response) => {
  const header = response.headers.get('set-cookie') ?? ''
  return header.split(';')[0] ?? ''
}

/** the attributes, which the cookie value alone throws away */
const attributesOf = (response: Response) =>
  (response.headers.get('set-cookie') ?? '')
    .split(';')
    .slice(1)
    .map((part) => part.trim())

describe.runIf(postgresAvailable)('signing in', () => {
  it('offers only the providers whose driver this assembly loaded', async () => {
    const response = await fetch(`${base}/auth/login-methods`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { methods: { code: string; mode: string }[] }
    // the cas row is enabled and has no driver here: offering it would render
    // a sign-in form nothing can answer
    expect(body.methods).toEqual([
      {
        code: 'password',
        type: 'local',
        name: 'Password',
        mode: 'component',
        component: 'auth-local/LoginMethod',
      },
    ])
  })

  it('turns a proved password into a session, and reads it back', async () => {
    const response = await login({ identifier: 'ada', password })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      user: { id: userId, displayName: 'Ada', tenant: { slug: 'default' } },
    })
    const cookie = cookieFrom(response)
    expect(cookie.startsWith(`${sessionCookieName}=`)).toBe(true)
    // Max-Age is a Duration upstream, and a bare number is milliseconds: the
    // ttl went out as `Max-Age=3` and every session died in three seconds
    // while its row still held an hour. Asserted in seconds, not merely present.
    expect(attributesOf(response)).toEqual(
      expect.arrayContaining(['Max-Age=3600', 'Path=/', 'HttpOnly', 'SameSite=Lax']),
    )
    // not secure here, because this test server is plain http
    expect(attributesOf(response)).not.toContain('Secure')

    const session = await fetch(`${base}/auth/session`, { headers: { cookie } })
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({ user: { id: userId } })

    // signing out ends that session, and the same cookie stops working
    const out = await fetch(`${base}/auth/session`, { method: 'DELETE', headers: { cookie } })
    expect(out.status).toBe(200)
    expect(await fetch(`${base}/auth/session`, { headers: { cookie } })).toMatchObject({
      status: 401,
    })
  })

  it('answers every credential failure the same way', async () => {
    // an unknown person, a wrong password, an unknown provider and a provider
    // of another driver's type are one answer, because telling them apart
    // tells a stranger which accounts and which providers exist
    for (const attempt of [
      login({ identifier: 'nobody', password }),
      login({ identifier: 'ada', password: 'wrong password entirely' }),
      login({ identifier: 'ada', password }, 'no-such-provider'),
      login({ identifier: 'ada', password }, 'campus'),
    ]) {
      const response = await attempt
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ _tag: 'INVALID_CREDENTIALS' })
    }
  })

  it('refuses a password for a type that does not admit one', async () => {
    // the credential is stored and correct; the type is what says no
    const response = await login({ identifier: 'grace', password })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: 'INVALID_CREDENTIALS' })
  })

  it('drops the cookie when the session it presented is dead', async () => {
    // Without this the browser keeps re-presenting a token the server has
    // already refused until the cookie's own lifetime lapses.
    const response = await login({ identifier: 'ada', password })
    const cookie = cookieFrom(response)
    const token = cookie.slice(sessionCookieName.length + 1)
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.execute(
          sql`update sessions set expires_at = now() - interval '1 minute'
              where token_hash = ${hashSessionToken(token)}`,
        )
      }).pipe(Effect.provide(probeInfra())),
    )
    const dead = await fetch(`${base}/auth/session`, { headers: { cookie } })
    expect(dead.status).toBe(401)
    expect(await dead.json()).toMatchObject({ _tag: 'SESSION_EXPIRED' })
    expect(dead.headers.get('set-cookie') ?? '').toContain('Max-Age=0')
  })

  it('drops the cookie when the account behind a live session is disabled', async () => {
    // this branch does not delete the row either, so a user disabled and later
    // re-enabled would otherwise resume on the same cookie
    const response = await login({ identifier: 'ada', password })
    const cookie = cookieFrom(response)
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.execute(sql`update users set enabled = false where display_name = 'Ada'`)
      }).pipe(Effect.provide(probeInfra())),
    )
    const refused = await fetch(`${base}/auth/session`, { headers: { cookie } })
    expect(refused.status).toBe(401)
    expect(refused.headers.get('set-cookie') ?? '').toContain('Max-Age=0')
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.execute(sql`update users set enabled = true where display_name = 'Ada'`)
      }).pipe(Effect.provide(probeInfra())),
    )
  })

  it('records the address the session was created from', async () => {
    const response = await login({ identifier: 'ada', password })
    const token = cookieFrom(response).slice(sessionCookieName.length + 1)
    const ip = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database
        const result = (yield* database.execute(
          sql`select login_ip::text from sessions where token_hash = ${hashSessionToken(token)}`,
        )) as unknown as { rows: { login_ip: string | null }[] }
        return result.rows[0]!.login_ip
      }).pipe(Effect.provide(probeInfra())),
    )
    // Audit data, not a response field: nothing reads it, so nothing noticed
    // that every Effect-created session recorded no address at all. Node
    // reports loopback as the IPv4-mapped IPv6 form, and inet stores it as
    // written, so the assertion is that an address arrived at all.
    expect(ip).toMatch(/127\.0\.0\.1/)
  })

  it('normalizes the identifier before it looks anything up', async () => {
    // from local-login.test.ts 'logs in with normalized identifier'. The stored
    // identifier is the normalized form, so a login that skipped normalizing
    // would refuse the same person depending on how they typed their name.
    for (const typed of ['  ADA  ', 'Ada', 'ada']) {
      const response = await login({ identifier: typed, password })
      expect(response.status, `${typed} should be the same person`).toBe(200)
    }
    // and a shape the normalizer rejects is refused like any other miss,
    // without reaching the database
    const bad = await login({ identifier: 'a', password })
    expect(bad.status).toBe(401)
  })

  it('stores only the hash of a session token', async () => {
    // from local-login.test.ts of the same name. A readable token column is a
    // password file: anyone with a database dump could present one.
    const response = await login({ identifier: 'ada', password })
    const token = cookieFrom(response).slice(sessionCookieName.length + 1)
    const stored = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database
        const result = (yield* database.execute(
          sql`select token_hash from sessions where token_hash = ${hashSessionToken(token)}`,
        )) as unknown as { rows: { token_hash: string }[] }
        return result.rows[0]?.token_hash
      }).pipe(Effect.provide(probeInfra())),
    )
    expect(stored).toBeDefined()
    expect(stored).not.toBe(token)
    expect(stored).toBe(hashSessionToken(token))
  })

  it('signs out a caller who was never signed in', async () => {
    const response = await fetch(`${base}/auth/session`, { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})
