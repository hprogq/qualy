import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'drizzle-orm'
import { Effect, Exit, Layer, Redacted, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Database, DatabaseConfig, layer as databaseLayer } from '@qualy/plugin-database/effect'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { LoginDrivers } from '@qualy/auth-contract/login'
import { hashPassword } from '@qualy/plugin-auth-local/password'
import { authLocalApiHandlers } from '@qualy/plugin-auth-local/effect'
import { authLocalApiGroup } from '@qualy/plugin-auth-local/api'
import { driver as localDriver } from '@qualy/plugin-auth-local/login-driver'
import { sessionApiGroup } from '../src/api.ts'
import { sessionApiHandlers } from '../src/effect/index.ts'
import { AuthConfig, layer as signInLayer } from '../src/effect/sign-in.ts'
import { layer as sessionLayer, sessionCookieName } from '../src/effect/session.ts'

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
  const config = Layer.succeed(
    DatabaseConfig,
    DatabaseConfig.of({
      url: Redacted.make(db.url),
      migrations: 'apply',
      migrationsFolder: new URL('../../../../../db/migrations', import.meta.url).pathname,
    }),
  )
  const infra = databaseLayer.pipe(Layer.provide(config))
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
    Layer.provide(sessionLayer.pipe(Layer.provide(infra))),
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

  it('signs out a caller who was never signed in', async () => {
    const response = await fetch(`${base}/auth/session`, { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})
