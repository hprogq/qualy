import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'kysely'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { HttpRouter } from 'effect/http'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { ANONYMOUS_IDENTITY, QUALY_API_ID, QUALY_IDENTITY_HEADER } from '@qualy/api-kit'
import { QUALY_CLIENT_PROTOCOL_HEADER } from '@qualy/release-contract'
import {
  Authenticated,
  CurrentUser,
  CurrentViewer,
  IdentityChanged,
  IdentityProbe,
  IdentityUnasserted,
  Viewer,
  sessionCookieName,
} from '@qualy/auth-contract/session'
import { identityKeyOf, judgeDocumentIdentity } from '@qualy/auth-contract/identity-key'
import { hashSessionToken } from '../src/session.ts'
import { layer as sessionLayer, pageMaySignOut, viewerLayer } from '../src/server/session.ts'
import { AuthConfig } from '../src/server/auth-config.ts'
import { authClosure } from './support/closure.ts'

// A page says whose it is, and nothing is done for it as anybody else
// (docs/adr/0013-document-identity.md).
//
// A tab loaded for A goes on sending A's work after another tab signed in as
// B and the shared cookie became B's. The server used to have nothing to
// refuse it by. Now the page names its person on every request and the
// session middlewares compare that with the session before any handler runs:
// a different person is refused, a person whose session lapsed is told so and
// may come back, and a page of ours that names nobody is refused as broken.

const port = 3225
const base = `http://127.0.0.1:${port}`

// what each handler did, so a refusal can be shown to have come before it
const ran = { read: 0, write: 0, viewed: 0, signOut: 0, probe: 0 }

const api = HttpApi.make(QUALY_API_ID).add(
  HttpApiGroup.make('probe')
    .add(
      HttpApiEndpoint.get('read', '/probe/read', {
        success: Schema.Struct({ userId: Schema.String }),
      }).middleware(Authenticated),
    )
    .add(
      HttpApiEndpoint.post('write', '/probe/write', {
        success: Schema.Struct({ ok: Schema.Boolean }),
      }).middleware(Authenticated),
    )
    .add(
      HttpApiEndpoint.get('viewed', '/probe/viewed', {
        success: Schema.Struct({ userId: Schema.NullOr(Schema.String) }),
      }).middleware(Viewer),
    )
    .add(
      HttpApiEndpoint.get('probe', '/probe/who', {
        success: Schema.Struct({ userId: Schema.String }),
      })
        .middleware(Authenticated)
        .annotate(IdentityProbe, true),
    )
    .add(
      HttpApiEndpoint.delete('signOut', '/probe/session', {
        success: Schema.Struct({ ok: Schema.Boolean }),
        error: [IdentityChanged, IdentityUnasserted],
      }),
    ),
)

const handlers = HttpApiBuilder.group(api, 'probe', (h) =>
  h
    .handle('read', () =>
      Effect.gen(function* () {
        ran.read += 1
        return { userId: (yield* CurrentUser).userId }
      }),
    )
    .handle('write', () =>
      Effect.sync(() => {
        ran.write += 1
        return { ok: true }
      }),
    )
    .handle('viewed', () =>
      Effect.gen(function* () {
        ran.viewed += 1
        return { userId: (yield* CurrentViewer).principal?.userId ?? null }
      }),
    )
    .handle('probe', () =>
      Effect.gen(function* () {
        ran.probe += 1
        return { userId: (yield* CurrentUser).userId }
      }),
    )
    .handle('signOut', () =>
      pageMaySignOut('qualy_session', undefined).pipe(
        Effect.andThen(
          Effect.sync(() => {
            ran.signOut += 1
            return { ok: true }
          }),
        ),
      ),
    ),
)

let scope: Scope.Closeable
let db: Awaited<ReturnType<typeof createTestContext>>
let tenantId: string
let ada: string
let bob: string

const tokens = {
  ada: 'token-ada',
  adaLater: 'token-ada-later',
  adaLapsed: 'token-ada-lapsed',
  bob: 'token-bob',
}

const seed = Effect.fn('seed')(function* () {
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
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
  const person = (name: string) =>
    runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, ${name}, ${userType}, ${node}) returning id`).pipe(
      Effect.map((result) => one<{ id: string }>(result).id),
    )
  const a = yield* person('Ada')
  const b = yield* person('Bob')
  const put = (userId: string, token: string, expires: string) =>
    runSql(sql`
      insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
      select ${tenant}, ${userId}, p.id, ${hashSessionToken(token)}, now() + ${sql.raw(expires)}
        from auth_providers p where p.tenant_id = ${tenant} and p.code = 'local'`)
  yield* put(a, tokens.ada, `interval '1 day'`)
  yield* put(a, tokens.adaLater, `interval '1 day'`)
  yield* put(a, tokens.adaLapsed, `interval '-1 minute'`)
  yield* put(b, tokens.bob, `interval '1 day'`)
  return { tenant, a, b }
})

beforeAll(async () => {
  if (!postgresAvailable) return
  db = await createTestContext('effect-document-identity')
  const infra = databaseFor(db.url, { entities: authClosure })
  const authConfig = Layer.succeed(
    AuthConfig,
    AuthConfig.of({
      defaultTenantSlug: 'default',
      sessionTtlSeconds: 3600,
      secureCookies: false,
      sessionCookieName: 'qualy_session',
    }),
  )
  const sessions = Layer.mergeAll(sessionLayer, viewerLayer).pipe(
    Layer.provide(Layer.mergeAll(infra, authConfig)),
  )
  const application = HttpRouter.serve(
    HttpApiBuilder.layer(api).pipe(
      Layer.provide(handlers.pipe(Layer.provide(Layer.mergeAll(sessions, infra)))),
    ),
  ).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })), Layer.provide(infra))
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
  const seeded = await Effect.runPromise(seed().pipe(Effect.provide(infra)))
  tenantId = seeded.tenant
  ada = seeded.a
  bob = seeded.b
}, 60_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope, Exit.void))
  await db.dispose()
})

/** a request from a page of ours: its protocol, and whose it says it is */
const fromPage = (
  path: string,
  options: { token?: string; declared?: string; method?: string } = {},
) =>
  fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      [QUALY_CLIENT_PROTOCOL_HEADER]: '5',
      ...(options.token === undefined ? {} : { cookie: `${sessionCookieName}=${options.token}` }),
      ...(options.declared === undefined ? {} : { [QUALY_IDENTITY_HEADER]: options.declared }),
    },
  })

const tagOf = async (response: Response) => ((await response.json()) as { _tag?: string })._tag

const identityOf = (userId: string) => identityKeyOf({ tenantId, userId })

describe('the identity judgment', () => {
  const someone = { state: 'valid' as const, principal: { tenantId: 't', userId: 'a' } }
  const key = identityKeyOf(someone.principal)

  it('passes a request that is not from a page of ours, whatever it says', () => {
    expect(judgeDocumentIdentity({ declared: undefined, fromPage: false, session: someone })).toBe(
      'pass',
    )
  })

  it('tells a lapsed session apart from somebody else', () => {
    expect(judgeDocumentIdentity({ declared: key, fromPage: true, session: someone })).toBe('pass')
    expect(
      judgeDocumentIdentity({ declared: key, fromPage: true, session: { state: 'expired' } }),
    ).toBe('expired')
    expect(
      judgeDocumentIdentity({ declared: key, fromPage: true, session: { state: 'absent' } }),
    ).toBe('absent')
    expect(
      judgeDocumentIdentity({
        declared: key,
        fromPage: true,
        session: { state: 'valid', principal: { tenantId: 't', userId: 'b' } },
      }),
    ).toBe('changed')
  })

  it('lets a page of nobody go on as nobody, and not as somebody', () => {
    expect(
      judgeDocumentIdentity({
        declared: ANONYMOUS_IDENTITY,
        fromPage: true,
        session: { state: 'absent' },
      }),
    ).toBe('pass')
    expect(
      judgeDocumentIdentity({ declared: ANONYMOUS_IDENTITY, fromPage: true, session: someone }),
    ).toBe('changed')
  })

  it('takes a page of ours that names nobody as broken, never as anybody', () => {
    expect(judgeDocumentIdentity({ declared: undefined, fromPage: true, session: someone })).toBe(
      'unasserted',
    )
    expect(judgeDocumentIdentity({ declared: '', fromPage: true, session: someone })).toBe(
      'unasserted',
    )
  })
})

describe.runIf(postgresAvailable)('a page and the session behind it', () => {
  it("serves a page as its own person, in any of that person's sessions", async () => {
    const first = await fromPage('/probe/read', { token: tokens.ada, declared: identityOf(ada) })
    expect(first.status).toBe(200)
    const later = await fromPage('/probe/read', {
      token: tokens.adaLater,
      declared: identityOf(ada),
    })
    expect(later.status).toBe(200)
    expect(await later.json()).toEqual({ userId: ada })
  })

  it("refuses A's page acting on B's session, before any handler runs", async () => {
    const before = { ...ran }
    const read = await fromPage('/probe/read', { token: tokens.bob, declared: identityOf(ada) })
    const write = await fromPage('/probe/write', {
      token: tokens.bob,
      declared: identityOf(ada),
      method: 'POST',
    })
    const viewed = await fromPage('/probe/viewed', {
      token: tokens.bob,
      declared: identityOf(ada),
    })
    const signOut = await fromPage('/probe/session', {
      token: tokens.bob,
      declared: identityOf(ada),
      method: 'DELETE',
    })
    for (const response of [read, write, viewed, signOut]) {
      expect(response.status).toBe(409)
      expect(await tagOf(response)).toBe('IDENTITY_CHANGED')
    }
    expect(ran).toEqual(before)
  })

  it("tells A's page that A's session lapsed, so A can come back to it", async () => {
    const lapsed = await fromPage('/probe/read', {
      token: tokens.adaLapsed,
      declared: identityOf(ada),
    })
    expect(lapsed.status).toBe(401)
    expect(await tagOf(lapsed)).toBe('SESSION_EXPIRED')
    // the cookie is still told to go, as before
    expect(
      lapsed.headers.getSetCookie().some((cookie) => cookie.startsWith('qualy_session=;')),
    ).toBe(true)
    // a read that may be anonymous is not answered as nobody for A's page
    const viewed = await fromPage('/probe/viewed', { declared: identityOf(ada) })
    expect(viewed.status).toBe(401)
    expect(await tagOf(viewed)).toBe('AUTH_REQUIRED')
    // and once A is signed in again, the page goes on
    const back = await fromPage('/probe/write', {
      token: tokens.adaLater,
      declared: identityOf(ada),
      method: 'POST',
    })
    expect(back.status).toBe(200)
  })

  it('refuses a page of ours that does not say whose it is, as broken rather than as somebody', async () => {
    const before = { ...ran }
    for (const path of ['/probe/read', '/probe/viewed']) {
      const response = await fromPage(path, { token: tokens.ada })
      expect(response.status).toBe(409)
      expect(await tagOf(response)).toBe('IDENTITY_UNASSERTED')
    }
    expect(ran).toEqual(before)
  })

  it('answers who is signed in to anybody who asks, whoever the page was', async () => {
    const asked = await fromPage('/probe/who', { token: tokens.bob, declared: identityOf(ada) })
    expect(asked.status).toBe(200)
    expect(await asked.json()).toEqual({ userId: bob })
  })

  it("refuses a page of nobody acting on somebody's session", async () => {
    const response = await fromPage('/probe/viewed', {
      token: tokens.bob,
      declared: ANONYMOUS_IDENTITY,
    })
    expect(response.status).toBe(409)
    expect(await tagOf(response)).toBe('IDENTITY_CHANGED')
    // and serves it as nobody when nobody is signed in
    const anonymous = await fromPage('/probe/viewed', { declared: ANONYMOUS_IDENTITY })
    expect(anonymous.status).toBe(200)
    expect(await anonymous.json()).toEqual({ userId: null })
  })

  it('signs a page out of nothing, but never out of somebody else', async () => {
    const nothing = await fromPage('/probe/session', {
      declared: identityOf(ada),
      method: 'DELETE',
    })
    expect(nothing.status).toBe(200)
    const own = await fromPage('/probe/session', {
      token: tokens.adaLater,
      declared: identityOf(ada),
      method: 'DELETE',
    })
    expect(own.status).toBe(200)
  })

  it('keeps answering a client that is not a page of ours as before', async () => {
    const response = await fetch(`${base}/probe/read`, {
      headers: { cookie: `${sessionCookieName}=${tokens.bob}` },
    })
    expect(response.status).toBe(200)
  })
})
