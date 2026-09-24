import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'kysely'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { requestContext } from '@qualy/api-kit/request'
import { Api } from '@qualy/api-kit/plugin'
import { loginDriversLayer, registerLoginDriver } from '@qualy/auth-contract/login'
import { hashPassword } from '@qualy/plugin-auth-local/password'
import {
  apiHandlers as authLocalApiHandlers,
  driver as localDriver,
} from '@qualy/plugin-auth-local'
import { authLocalApiGroup } from '@qualy/plugin-auth-local/api'
import { createSessionToken } from '../src/session.ts'
import { sessionApiGroup } from '../src/api.ts'
import { sessionApiHandlers } from '../src/server/index.ts'
import { AuthConfig, layer as signInLayer } from '../src/server/sign-in.ts'
import { sessionCookieName } from '@qualy/auth-contract/session'
import { layer as sessionLayer } from '../src/server/session.ts'
import { sessionCookieNameFor } from '../src/server/session-cookie.ts'
import { authClosure } from './support/closure.ts'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'
import { authAuditLayer } from './support/audit.ts'
import { unusedEmailFlows } from './support/email-flows.ts'
import { singleTenantLayer } from '../src/server/tenancy.ts'
import { singleOriginLayer } from '../src/server/public-origin.ts'
import { SEEDED_EMAILS, seedSignIn } from './support/sign-in-seed.ts'

// The session cookie of a secure deployment: named with the `__Host-`
// prefix, which no other host can plant for this one, and the ONLY name
// the process reads. The bare name a browser may still carry - from before
// the rename, or planted by a sibling host - is dropped once at sign-in and
// ignored ever after. Served over plain http here, which a browser would
// refuse the cookie on; these requests are made by hand, so the server's
// side of the rule can be held on its own.

const api = Api.local(sessionApiGroup, authLocalApiGroup)

const port = 3211
const base = `http://127.0.0.1:${port}${QUALY_API_PREFIX}`
const password = 'correct horse battery staple'
const secureName = sessionCookieNameFor(true)

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>
let seeded: { tenant: string; user: string; other: string }

beforeAll(async () => {
  if (!postgresAvailable) return
  db = await createTestContext('effect-secure-cookie')
  const infra = databaseFor(db.url, { entities: authClosure })
  const authConfig = Layer.succeed(
    AuthConfig,
    AuthConfig.of({
      defaultTenantSlug: 'default',
      sessionTtlSeconds: 3600,
      secureCookies: true,
      sessionCookieName: secureName,
    }),
  )
  const signIn = signInLayer.pipe(
    Layer.provide(captchaLayer),
    Layer.provide(secretsLayer),
    // the deployment's one tenant and its one public address, as the host
    // provides them
    Layer.provide(Layer.mergeAll(singleTenantLayer, singleOriginLayer)),
    Layer.provide(authAuditLayer),
    Layer.provide(
      Layer.mergeAll(
        infra,
        authConfig,
        registerLoginDriver(localDriver, '@qualy/plugin-auth-local').pipe(
          Layer.provideMerge(loginDriversLayer),
        ),
      ),
    ),
  )
  const handlers = Layer.mergeAll(sessionApiHandlers, authLocalApiHandlers).pipe(
    Layer.provide(sessionLayer.pipe(Layer.provide(Layer.mergeAll(infra, authConfig)))),
  )
  const application = HttpRouter.serve(HttpApiBuilder.layer(api).pipe(Layer.provide(handlers)), {
    middleware: requestContext(),
  }).pipe(
    Layer.provide(signIn),
    Layer.provide(unusedEmailFlows),
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provide(infra),
  )
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
  seeded = await Effect.runPromise(
    seedSignIn(await hashPassword(password)).pipe(Effect.provide(infra)),
  )
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope, Exit.void))
  await db.dispose()
})

const login = () =>
  fetch(`${base}/auth/local/password/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: SEEDED_EMAILS.ada, password }),
  })

/** each Set-Cookie line, split into its name, value and attributes */
const cookiesSet = (response: Response) =>
  response.headers.getSetCookie().map((line) => {
    const [pair = '', ...attributes] = line.split(';').map((part) => part.trim())
    const at = pair.indexOf('=')
    return { name: pair.slice(0, at), value: pair.slice(at + 1), attributes }
  })

/** a session row for the other person, minted by hand: nobody's password is involved */
const mintSessionFor = async (userId: string): Promise<string> => {
  const { token, tokenHash } = createSessionToken()
  await Effect.runPromise(
    runSql(sql`
      insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
      select ${seeded.tenant}, ${userId}, p.id, ${tokenHash}, now() + interval '1 day'
        from auth_providers p where p.tenant_id = ${seeded.tenant} and p.code = 'password'`).pipe(
      Effect.provide(databaseFor(db.url, { migrations: 'off', entities: authClosure })),
    ),
  )
  return token
}

describe.runIf(postgresAvailable)('the session cookie of a secure deployment', () => {
  it('is set under the prefixed name, as a host cookie, and drops the bare name once', async () => {
    const response = await login()
    expect(response.status).toBe(200)
    const set = cookiesSet(response)
    expect(set.map((cookie) => cookie.name)).toEqual([secureName, sessionCookieName])

    const [session, legacy] = set
    expect(session!.value).not.toBe('')
    expect(session!.attributes).toEqual(
      expect.arrayContaining(['Max-Age=3600', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']),
    )
    expect(session!.attributes.some((attribute) => attribute.startsWith('Domain='))).toBe(false)

    expect(legacy!.value).toBe('')
    expect(legacy!.attributes).toEqual(expect.arrayContaining(['Max-Age=0', 'Path=/']))
  })

  it('reads the prefixed name and only that name', async () => {
    const token = cookiesSet(await login())[0]!.value

    const prefixed = await fetch(`${base}/auth/session`, {
      headers: { cookie: `${secureName}=${token}` },
    })
    expect(prefixed.status).toBe(200)
    expect(await prefixed.json()).toMatchObject({ user: { id: seeded.user } })

    // the same token under the bare name is a request with no session
    const bare = await fetch(`${base}/auth/session`, {
      headers: { cookie: `${sessionCookieName}=${token}` },
    })
    expect(bare.status).toBe(401)
    expect(await bare.json()).toMatchObject({ _tag: 'AUTH_REQUIRED' })

    // both present, the bare one a valid session of somebody else: the
    // prefixed one is the session, the other is not read
    const planted = await mintSessionFor(seeded.other)
    const both = await fetch(`${base}/auth/session`, {
      headers: { cookie: `${sessionCookieName}=${planted}; ${secureName}=${token}` },
    })
    expect(both.status).toBe(200)
    expect(await both.json()).toMatchObject({ user: { id: seeded.user } })
  })

  it('signs out by clearing the prefixed name', async () => {
    const token = cookiesSet(await login())[0]!.value
    const out = await fetch(`${base}/auth/session`, {
      method: 'DELETE',
      headers: { cookie: `${secureName}=${token}` },
    })
    expect(out.status).toBe(200)
    const cleared = cookiesSet(out)
    expect(cleared.map((cookie) => cookie.name)).toEqual([secureName])
    expect(cleared[0]!.value).toBe('')
    expect(cleared[0]!.attributes).toEqual(expect.arrayContaining(['Max-Age=0', 'Secure']))
    expect(
      (await fetch(`${base}/auth/session`, { headers: { cookie: `${secureName}=${token}` } }))
        .status,
    ).toBe(401)
  })
})
