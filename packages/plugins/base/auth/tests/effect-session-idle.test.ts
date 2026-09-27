import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'kysely'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { QUALY_API_ID, QUALY_BACKGROUND_HEADER } from '@qualy/api-kit'
import { hashSessionToken } from '../src/session.ts'
import { Authenticated, CurrentUser, sessionCookieName } from '@qualy/auth-contract/session'
import { layer as sessionLayer } from '../src/server/session.ts'
import {
  AuthConfig,
  DEFAULT_SESSION_IDLE_SECONDS,
  sessionIdleFrom,
} from '../src/server/auth-config.ts'
import { authClosure } from './support/closure.ts'

// A session ends when its reader stops using it, not only when its week runs
// out. Use is recorded at most every five minutes, so the limit is kept with
// that slack: a session last recorded 1h55 ago is live, one 2h05 ago is over.
// The page's own traffic - polls, refetches, a hidden tab - is served without
// counting as use, or a page left open would keep itself signed in forever.

const port = 3229
const base = `http://127.0.0.1:${port}`

const api = HttpApi.make(QUALY_API_ID).add(
  HttpApiGroup.make('probe').add(
    HttpApiEndpoint.get('me', '/probe/me', {
      success: Schema.Struct({ userId: Schema.String }),
    }).middleware(Authenticated),
  ),
)

const handlers = HttpApiBuilder.group(api, 'probe', (h) =>
  h.handle('me', () =>
    Effect.gen(function* () {
      const principal = yield* CurrentUser
      return { userId: principal.userId }
    }),
  ),
)

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>
let infra: ReturnType<typeof databaseFor>
let tenant: string
let user: string

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** a session for the one user, last recorded as used `ago` (a postgres interval) before now */
const session = (token: string, ago: string | null) =>
  Effect.runPromise(
    runSql(sql`
      insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at, last_used_at, created_at)
      select ${tenant}, ${user}, p.id, ${hashSessionToken(token)}, now() + interval '7 days',
             ${ago === null ? sql`null` : sql`now() - ${sql.raw(`interval '${ago}'`)}`},
             now() - interval '3 hours'
        from auth_providers p where p.tenant_id = ${tenant} and p.code = 'local'`).pipe(
      Effect.provide(infra),
    ),
  )

const lastUsed = (token: string) =>
  Effect.runPromise(
    Effect.map(
      runSql(sql`
        select extract(epoch from now() - last_used_at)::int as seconds
          from sessions where token_hash = ${hashSessionToken(token)}`),
      (result) => one<{ seconds: number } | undefined>(result)?.seconds,
    ).pipe(Effect.provide(infra)),
  )

const ask = (token: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/probe/me`, { headers: { cookie: `${sessionCookieName}=${token}`, ...headers } })

beforeAll(async () => {
  if (!postgresAvailable) return
  db = await createTestContext('effect-session-idle')
  infra = databaseFor(db.url, { entities: authClosure })
  const authConfig = Layer.succeed(
    AuthConfig,
    AuthConfig.of({
      defaultTenantSlug: 'default',
      sessionTtlSeconds: 604_800,
      sessionIdleSeconds: DEFAULT_SESSION_IDLE_SECONDS,
      secureCookies: false,
      sessionCookieName: 'qualy_session',
    }),
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
  await Effect.runPromise(
    Effect.gen(function* () {
      tenant = one<{ id: string }>(
        yield* runSql(sql`insert into tenants (slug, name) values ('t','T') returning id`),
      ).id
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
      const userType = one<{ id: string }>(
        yield* runSql(sql`
          insert into user_types (tenant_id, code, name, placement_mode)
          values (${tenant},'staff','Staff', 'unrestricted') returning id`),
      ).id
      user = one<{ id: string }>(
        yield* runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
          values (${tenant}, 'Ada', ${userType}, ${node}) returning id`),
      ).id
    }).pipe(Effect.provide(infra)),
  )
}, 60_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope, Exit.void))
  await db.dispose()
})

describe.runIf(postgresAvailable)('a session left unused', () => {
  it('stays live 1h55 after its last recorded use, and records this one', async () => {
    await session('used-1h55', '1 hour 55 minutes')
    const response = await ask('used-1h55')
    expect(response.status).toBe(200)
    expect(await lastUsed('used-1h55')).toBeLessThan(60)
  })

  it('is over 2h05 after its last recorded use: refused as expired, and deleted', async () => {
    await session('used-2h05', '2 hours 5 minutes')
    const response = await ask('used-2h05')
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: 'SESSION_EXPIRED' })
    expect(response.headers.get('set-cookie')).toContain(`${sessionCookieName}=`)
    expect(await lastUsed('used-2h05')).toBeUndefined()
  })

  it('counts from its start when it was never used since', async () => {
    // created three hours ago and never recorded as used
    await session('never-used', null)
    const response = await ask('never-used')
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: 'SESSION_EXPIRED' })
  })

  it("serves the page's own traffic without counting it as use", async () => {
    await session('polled', '1 hour 50 minutes')
    const polled = await ask('polled', { [QUALY_BACKGROUND_HEADER]: '1' })
    expect(polled.status).toBe(200)
    // still recorded as used an hour and fifty minutes ago
    expect(await lastUsed('polled')).toBeGreaterThan(6_000)
    // and a request the reader made is use
    const read = await ask('polled')
    expect(read.status).toBe(200)
    expect(await lastUsed('polled')).toBeLessThan(60)
  })

  it('ends a session the page alone kept polling once the reader has been gone long enough', async () => {
    await session('abandoned', '2 hours 1 minute')
    const polled = await ask('abandoned', { [QUALY_BACKGROUND_HEADER]: '1' })
    expect(polled.status).toBe(401)
    expect(await polled.json()).toMatchObject({ _tag: 'SESSION_EXPIRED' })
  })
})

describe('the idle limit a deployment sets', () => {
  it('defaults to two hours, takes 0 as none, and refuses what would end sessions in use', () => {
    expect(sessionIdleFrom('')).toBe(7_200)
    expect(sessionIdleFrom(' 3600 ')).toBe(3_600)
    expect(sessionIdleFrom('0')).toBeUndefined()
    for (const refused of ['599', '60', '-1', '2h', '1.5', '7200s']) {
      expect(sessionIdleFrom(refused), refused).toBe('malformed')
    }
  })
})
