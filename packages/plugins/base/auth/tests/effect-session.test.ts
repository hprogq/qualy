import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'drizzle-orm'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  OpenApi,
} from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, databaseFor, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Database } from '@qualy/plugin-database/server'
import { QUALY_API_ID } from '@qualy/api-kit'
import { hashSessionToken } from '../src/session.ts'
import {
  Authenticated,
  CurrentUser,
  sessionCookieName,
  layer as sessionLayer,
} from '../src/server/session.ts'
import { AuthConfig } from '../src/server/auth-config.ts'
import { authClosure } from './support/closure.ts'


// The session as a middleware, over a real server and a real database.
//
// The cordis enricher cannot reject, because it runs before every request and
// does not know whether the endpoint needs a principal. An endpoint that
// forgets its requireAuth therefore sees principal as undefined and carries
// on. This replaces that with a middleware whose `provides` an endpoint has to
// declare, so forgetting is not expressible rather than merely discouraged.

const port = 3194
const base = `http://127.0.0.1:${port}`

const api = HttpApi.make(QUALY_API_ID).add(
  HttpApiGroup.make('probe')
    .add(
      HttpApiEndpoint.get('me', '/probe/me', {
        success: Schema.Struct({ userId: Schema.String }),
      }).middleware(Authenticated),
    )
    .add(
      HttpApiEndpoint.get('open', '/probe/open', {
        success: Schema.Struct({ ok: Schema.Boolean }),
      }),
    ),
)

const handlers = HttpApiBuilder.group(api, 'probe', (h) =>
  h
    .handle('me', () =>
      Effect.gen(function* () {
        // not optional: the middleware provided it, so there is no undefined
        // case for this handler to forget about
        const principal = yield* CurrentUser
        return { userId: principal.userId }
      }),
    )
    .handle('open', () => Effect.succeed({ ok: true })),
)

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>
let validToken: string
let expiredToken: string
let disabledToken: string

const seed = Effect.fn('seed')(function* (tokens: {
  valid: string
  expired: string
  disabled: string
}) {
  const database = yield* Database
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* database.execute(sql`insert into tenants (slug, name) values ('t','T') returning id`),
  ).id
  const orgType = one<{ id: string }>(
    yield* database.execute(
      sql`insert into org_types (tenant_id, code, name) values (${tenant},'u','U') returning id`,
    ),
  ).id
  const node = one<{ id: string }>(
    yield* database.execute(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${tenant}, ${orgType}, 'Root', 'r', 0) returning id`),
  ).id
  const userType = one<{ id: string }>(
    yield* database.execute(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
      values (${tenant},'staff','Staff', true, 'unrestricted') returning id`),
  ).id
  const user = one<{ id: string }>(
    yield* database.execute(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Ada', ${userType}, ${node}) returning id`),
  ).id
  const off = one<{ id: string }>(
    yield* database.execute(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, enabled)
      values (${tenant}, 'Gone', ${userType}, ${node}, false) returning id`),
  ).id
  const put = (userId: string, token: string, expires: string) =>
    database.execute(sql`
      insert into sessions (tenant_id, user_id, token_hash, expires_at)
      values (${tenant}, ${userId}, ${hashSessionToken(token)}, now() + ${sql.raw(expires)})`)
  yield* put(user, tokens.valid, `interval '1 day'`)
  yield* put(user, tokens.expired, `interval '-1 minute'`)
  yield* put(off, tokens.disabled, `interval '1 day'`)
  return user
})

let userId: string

beforeAll(async () => {
  if (!postgresAvailable) return
  db = await createTestContext('effect-session')
  validToken = 'token-valid'
  expiredToken = 'token-expired'
  disabledToken = 'token-disabled'

  const infra = databaseFor(db.url, { entities: authClosure })
  const authConfig = Layer.succeed(
    AuthConfig,
    AuthConfig.of({ defaultTenantSlug: 'default', sessionTtlSeconds: 3600, secureCookies: false }),
  )
  const application = HttpRouter.serve(
    HttpApiBuilder.layer(api).pipe(
      Layer.provide(
        handlers.pipe(
          Layer.provide(sessionLayer.pipe(Layer.provide(Layer.mergeAll(infra, authConfig)))),
        ),
      ),
    ),
  ).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })), Layer.provide(infra))

  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
  userId = await Effect.runPromise(
    seed({ valid: validToken, expired: expiredToken, disabled: disabledToken }).pipe(
      Effect.provide(infra),
    ),
  )
}, 60_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope, Exit.void))
  await db.dispose()
})

const probeInfra = () => databaseFor(db.url, { migrations: 'off', entities: authClosure })

const withCookie = (token: string) =>
  fetch(`${base}/probe/me`, { headers: { cookie: `${sessionCookieName}=${token}` } })

describe.runIf(postgresAvailable)('the session middleware', () => {
  it('resolves a live session into a principal the handler cannot find undefined', async () => {
    const response = await withCookie(validToken)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ userId })
  })

  it('refuses a request with no cookie at all', async () => {
    const response = await fetch(`${base}/probe/me`)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: 'AUTH_REQUIRED' })
  })

  it('answers an unknown token exactly as it answers no token', async () => {
    // a caller must not be able to learn that a token once existed
    const response = await withCookie('never-issued')
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: 'AUTH_REQUIRED' })
  })

  it('tells an expired session apart, and deletes it', async () => {
    const response = await withCookie(expiredToken)
    expect(response.status).toBe(401)
    // distinct from AUTH_REQUIRED so the client can say "you were signed out"
    expect(await response.json()).toMatchObject({ _tag: 'SESSION_EXPIRED' })

    const gone = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database
        const result = (yield* database.execute(
          sql`select count(*)::int as count from sessions where token_hash = ${hashSessionToken(expiredToken)}`,
        )) as unknown as { rows: { count: number }[] }
        return result.rows[0]!.count
      }).pipe(Effect.provide(databaseFor(db.url, { migrations: 'off', entities: authClosure }))),
    )
    expect(gone).toBe(0)
  })

  it('stops accepting a session whose user was disabled', async () => {
    // the row is live and unexpired; the person behind it is not
    const response = await withCookie(disabledToken)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: 'AUTH_REQUIRED' })
  })

  it('stops accepting sessions once the tenant itself is disabled', async () => {
    // every other check is about the person; this one is about whether the
    // tenant may be used at all. It was missed once, because the user-type
    // alias and the tenant alias both look like a plausible `enabled`.
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.execute(sql`update tenants set enabled = false`)
      }).pipe(Effect.provide(probeInfra())),
    )
    const response = await withCookie(validToken)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: 'AUTH_REQUIRED' })
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.execute(sql`update tenants set enabled = true`)
      }).pipe(Effect.provide(probeInfra())),
    )
    expect((await withCookie(validToken)).status).toBe(200)
  })

  it('leaves an endpoint that declares no middleware open', async () => {
    const response = await fetch(`${base}/probe/open`)
    expect(response.status).toBe(200)
  })

  it('advertises the requirement only on the endpoint that declared it', async () => {
    const document = OpenApi.fromApi(api) as {
      components?: { securitySchemes?: Record<string, { type?: string; in?: string }> }
      paths: Record<string, Record<string, { security?: unknown }>>
    }
    expect(Object.values(document.components?.securitySchemes ?? {})).toContainEqual(
      expect.objectContaining({ type: 'apiKey', in: 'cookie' }),
    )
    expect(document.paths['/probe/me']!.get!.security).toEqual([{ session: [] }])
    expect(document.paths['/probe/open']!.get!.security).toEqual([])
  })
})
