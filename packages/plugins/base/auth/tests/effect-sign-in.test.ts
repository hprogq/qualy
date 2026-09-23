import fs from 'node:fs'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'kysely'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { RequestContext, requestContext } from '@qualy/api-kit/request'
import { Api } from '@qualy/api-kit/plugin'
import {
  LoginSessions,
  loginDriversLayer,
  registerLoginDriver,
  type LoginSessionsShape,
  type ResolvedProvider,
} from '@qualy/auth-contract/login'
import { hashPassword } from '@qualy/plugin-auth-local/password'
import { hashSessionToken } from '../src/session.ts'
import { SEEDED_EMAILS, seedSignIn } from './support/sign-in-seed.ts'
import { apiHandlers as authLocalApiHandlers, driver as localDriver } from '@qualy/plugin-auth-local'
import { authLocalApiGroup } from '@qualy/plugin-auth-local/api'
import { sessionApiGroup } from '../src/api.ts'
import { sessionApiHandlers } from '../src/server/index.ts'
import { AuthConfig, layer as signInLayer } from '../src/server/sign-in.ts'
import { sessionCookieName } from '@qualy/auth-contract/session'
import { layer as sessionLayer } from '../src/server/session.ts'
import { authClosure } from './support/closure.ts'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { authAuditLayer } from './support/audit.ts'
import { unusedEmailFlows } from './support/email-flows.ts'
import { singleTenantLayer } from '../src/server/tenancy.ts'
import { singleOriginLayer } from '../src/server/public-origin.ts'

// The whole sign-in cycle, over a real server: no method, an email and a
// password, the session it creates, and signing out again.
//
// The cases worth stating are the ones a screen would otherwise get wrong. A
// provider whose driver is not loaded must not be offered, or it renders a
// form nothing can answer. Every credential failure must look the same, or the
// answer tells a stranger which accounts exist. Signing out must succeed when
// there was nothing to sign out of, or the client has to handle a failure that
// means the thing it asked for is already true.

const port = 3195
const base = `http://127.0.0.1:${port}${QUALY_API_PREFIX}`

const api = Api.local(sessionApiGroup, authLocalApiGroup)

const password = 'correct horse battery staple'

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>

let userId: string
let providerId: string
/** the sign-in service as the server was given it, for asking it directly */
let signInService: Layer.Layer<LoginSessions, unknown>

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
      sessionCookieName,
    }),
  )
  // only the local driver is in the catalog, so the cas provider row has
  // nothing to present it
  const signIn = signInLayer.pipe(
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
  signInService = signIn
  const handlers = Layer.mergeAll(sessionApiHandlers, authLocalApiHandlers).pipe(
    Layer.provide(sessionLayer.pipe(Layer.provide(Layer.mergeAll(infra, authConfig)))),
  )
  // the service layers go in at the application level, the way the host wires
  // them: a handler's requirement is per-request, so it travels past the
  // handler layer and is satisfied where the whole api is assembled
  const application = HttpRouter.serve(HttpApiBuilder.layer(api).pipe(Layer.provide(handlers)), {
    // the host always serves behind this middleware; without it a session
    // records no address at all, which is the regression asserted below
    middleware: requestContext(),
  }).pipe(
    Layer.provide(signIn),
    Layer.provide(unusedEmailFlows),
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provide(infra),
  )

  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
  const hash = await hashPassword(password)
  // a password set before the length rule, which the door must still accept
  const shortHash = await hashPassword('short')
  const seeded = await Effect.runPromise(seedSignIn(hash, shortHash).pipe(Effect.provide(infra)))
  userId = seeded.user
  providerId = seeded.provider
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope, Exit.void))
  await db.dispose()
})

const probeInfra = () => databaseFor(db.url, { migrations: 'off', entities: authClosure })

// every case below starts with nothing counted: what one case tried does not
// throttle the next, and the cases about throttling say so on their own
beforeEach(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(
    runSql(sql`delete from auth_rate_limit_buckets`).pipe(Effect.provide(probeInfra())),
  )
})

const login = (body: { email: string; password: string }, code = 'password') =>
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
    const body = await response.json()
    // the cas row is enabled and has no driver here: offering it would render
    // a sign-in form nothing can answer. The workspace goes by name and by
    // nothing else, and a door with no icon chosen is drawn by its kind's own.
    expect(body).toEqual({
      tenant: { name: 'Default' },
      methods: [
        {
          code: 'password',
          type: 'local',
          name: 'Password',
          prominence: 'secondary',
          recommended: false,
          icon: { kind: 'builtin', key: 'mail' },
          mode: 'component',
        },
      ],
      passwordRule: { minLength: 12, maxLength: 128 },
    })
  })

  it('turns a proved password into a session, and reads it back', async () => {
    const response = await login({ email: SEEDED_EMAILS.ada, password })
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

    // the session remembers the door it came in through, and the binding
    const token = cookie.slice(sessionCookieName.length + 1)
    const origin = await Effect.runPromise(
      Effect.gen(function* () {
        const result = (yield* runSql(
          sql`select s.auth_provider_id, s.auth_binding_id, b.user_id as binding_user
                from sessions s
                left join user_auth_bindings b on b.id = s.auth_binding_id
               where s.token_hash = ${hashSessionToken(token)}`,
        )) as unknown as {
          rows: { auth_provider_id: string; auth_binding_id: string | null; binding_user: string }[]
        }
        return result.rows[0]!
      }).pipe(Effect.provide(probeInfra())),
    )
    expect(origin.auth_provider_id).toBe(providerId)
    expect(origin.binding_user).toBe(userId)

    // signing out ends that session, and the same cookie stops working
    const out = await fetch(`${base}/auth/session`, { method: 'DELETE', headers: { cookie } })
    expect(out.status).toBe(200)
    expect(await fetch(`${base}/auth/session`, { headers: { cookie } })).toMatchObject({
      status: 401,
    })
  })

  it('will not let a burst of misses take the thread pool with it', async () => {
    // argon2 is deliberately expensive, and node-argon2 spends that expense
    // on a libuv threadpool thread - the same four that serve every `fs`
    // read this process makes. Unthrottled, a handful of concurrent attempts
    // on the one unauthenticated write endpoint held the pool and 256 MiB,
    // so the whole server slowed rather than just the login.
    const misses = 10
    const attempts = Array.from({ length: misses }, () =>
      login({ email: SEEDED_EMAILS.ada, password: 'not the password' }),
    )
    const answers = await Promise.all(attempts)
    // every one of them is still answered, and answered the same way
    expect(answers.map((response) => response.status)).toEqual(
      Array.from({ length: misses }, () => 401),
    )
    // and the file the shell is served from is still readable while they run
    const readable = await fs.promises.readFile(new URL(import.meta.url)).then(
      () => true,
      () => false,
    )
    expect(readable).toBe(true)
  })

  it('answers every credential failure the same way', async () => {
    // an unknown person, somebody without a password, a wrong password, an
    // unknown provider and a provider of another driver's type are one
    // answer, because telling them apart tells a stranger which accounts and
    // which providers exist
    for (const attempt of [
      login({ email: SEEDED_EMAILS.lin, password }),
      login({ email: 'nobody@school.edu', password }),
      login({ email: SEEDED_EMAILS.ada, password: 'wrong password entirely' }),
      login({ email: SEEDED_EMAILS.ada, password }, 'no-such-provider'),
      login({ email: SEEDED_EMAILS.ada, password }, 'campus'),
    ]) {
      const response = await attempt
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ _tag: 'INVALID_CREDENTIALS' })
    }
  })

  it('refuses a password for a type outside the door\u2019s audience', async () => {
    // the credential is stored and correct; the audience is what says no
    const response = await login({ email: SEEDED_EMAILS.grace, password })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: 'INVALID_CREDENTIALS' })
  })

  it('reads only the name it was configured with, never the prefixed one', async () => {
    // a plain-http process names its cookie without the prefix; a request
    // that carries the token under the prefixed name is a request with no
    // session, because the process reads exactly one name
    const response = await login({ email: SEEDED_EMAILS.ada, password })
    const token = cookieFrom(response).slice(sessionCookieName.length + 1)
    const prefixed = await fetch(`${base}/auth/session`, {
      headers: { cookie: `__Host-${sessionCookieName}=${token}` },
    })
    expect(prefixed.status).toBe(401)
    expect(await prefixed.json()).toMatchObject({ _tag: 'AUTH_REQUIRED' })
  })

  it('drops the cookie when the session it presented is dead', async () => {
    // Without this the browser keeps re-presenting a token the server has
    // already refused until the cookie's own lifetime lapses.
    const response = await login({ email: SEEDED_EMAILS.ada, password })
    const cookie = cookieFrom(response)
    const token = cookie.slice(sessionCookieName.length + 1)
    await Effect.runPromise(
      runSql(
        sql`update sessions set expires_at = now() - interval '1 minute'
              where token_hash = ${hashSessionToken(token)}`,
      ).pipe(Effect.provide(probeInfra())),
    )
    const dead = await fetch(`${base}/auth/session`, { headers: { cookie } })
    expect(dead.status).toBe(401)
    expect(await dead.json()).toMatchObject({ _tag: 'SESSION_EXPIRED' })
    expect(dead.headers.get('set-cookie') ?? '').toContain('Max-Age=0')
  })

  it('drops the cookie when the account behind a live session is disabled', async () => {
    // this branch does not delete the row either, so a user disabled and later
    // re-enabled would otherwise resume on the same cookie
    const response = await login({ email: SEEDED_EMAILS.ada, password })
    const cookie = cookieFrom(response)
    await Effect.runPromise(
      runSql(sql`update users set enabled = false where display_name = 'Ada'`).pipe(
        Effect.provide(probeInfra()),
      ),
    )
    const refused = await fetch(`${base}/auth/session`, { headers: { cookie } })
    expect(refused.status).toBe(401)
    expect(refused.headers.get('set-cookie') ?? '').toContain('Max-Age=0')
    await Effect.runPromise(
      runSql(sql`update users set enabled = true where display_name = 'Ada'`).pipe(
        Effect.provide(probeInfra()),
      ),
    )
  })

  it('records the address the session was created from', async () => {
    const response = await login({ email: SEEDED_EMAILS.ada, password })
    const token = cookieFrom(response).slice(sessionCookieName.length + 1)
    const ip = await Effect.runPromise(
      Effect.gen(function* () {
        const result = (yield* runSql(
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

  it('normalizes the address before it looks anybody up', async () => {
    // The stored address is the normalized form, so a sign-in that skipped
    // normalizing would refuse the same person depending on how they typed it.
    for (const typed of ['  ADA@School.EDU  ', 'Ada@school.edu', SEEDED_EMAILS.ada]) {
      const response = await login({ email: typed, password })
      expect(response.status, `${typed} should be the same person`).toBe(200)
    }
    // and something that cannot be an address is refused like any other
    // miss, without reaching the database
    const bad = await login({ email: 'not-an-address', password })
    expect(bad.status).toBe(401)
    expect(await bad.json()).toMatchObject({ _tag: 'INVALID_CREDENTIALS' })
  })

  it('opens for a password set before the length rule', async () => {
    // the rules a new password must meet are asked when one is set, never at
    // the door: a stranger learns nothing about them, and an older password
    // still works until it is changed
    const response = await login({ email: SEEDED_EMAILS.mei, password: 'short' })
    expect(response.status).toBe(200)
  })

  it('stores only the hash of a session token', async () => {
    // from local-login.test.ts of the same name. A readable token column is a
    // password file: anyone with a database dump could present one.
    const response = await login({ email: SEEDED_EMAILS.ada, password })
    const token = cookieFrom(response).slice(sessionCookieName.length + 1)
    const stored = await Effect.runPromise(
      Effect.gen(function* () {
        const result = (yield* runSql(
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

describe.runIf(postgresAvailable)('the sign-in record', () => {
  type EventRow = {
    outcome: string
    reason_code: string | null
    user_id: string | null
    binding_id: string | null
    session_id: string | null
    provider_type: string
    provider_code: string
    request_id: string | null
    client_ip: string | null
    user_agent: string | null
  }

  /** the newest event, which under this file's sequential cases is the one just caused */
  const latestEvent = () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = (yield* runSql(
          sql`select outcome, reason_code, user_id, binding_id, session_id,
                     provider_type, provider_code, request_id, client_ip::text as client_ip,
                     user_agent
              from sign_in_events order by occurred_at desc, id desc limit 1`,
        )) as unknown as { rows: EventRow[] }
        return result.rows[0]!
      }).pipe(Effect.provide(probeInfra())),
    )

  it('records a success with its session and its request', async () => {
    const response = await login({ email: SEEDED_EMAILS.ada, password })
    expect(response.status).toBe(200)
    const event = await latestEvent()
    expect(event.outcome).toBe('success')
    expect(event.reason_code).toBeNull()
    expect(event.user_id).toBe(userId)
    expect(event.binding_id).not.toBeNull()
    expect(event.provider_type).toBe('local')
    expect(event.provider_code).toBe('password')
    // the same transaction wrote the session this event names
    const session = await Effect.runPromise(
      Effect.gen(function* () {
        const result = (yield* runSql(
          sql`select id from sessions where id = ${event.session_id}`,
        )) as unknown as { rows: { id: string }[] }
        return result.rows[0]
      }).pipe(Effect.provide(probeInfra())),
    )
    expect(session?.id).toBe(event.session_id)
    // request correlation comes from the request context, not from any caller
    expect(event.request_id).not.toBeNull()
    expect(event.client_ip).toMatch(/127\.0\.0\.1/)
    expect(event.user_agent).not.toBeNull()
  })

  it('records a wrong password against the account it was about', async () => {
    const refused = await login({ email: SEEDED_EMAILS.ada, password: 'wrong-password-1' })
    expect(refused.status).toBe(401)
    const event = await latestEvent()
    expect(event.outcome).toBe('failure')
    expect(event.reason_code).toBe('invalid-credentials')
    expect(event.user_id).toBe(userId)
    expect(event.binding_id).not.toBeNull()
    expect(event.session_id).toBeNull()
  })

  it('records an unknown address without storing it', async () => {
    const refused = await login({ email: 'nobody-here@school.edu', password })
    expect(refused.status).toBe(401)
    const event = await latestEvent()
    expect(event.outcome).toBe('failure')
    expect(event.reason_code).toBe('user-not-found')
    // nothing resolved, so nothing is named - and what was typed is nowhere
    expect(event.user_id).toBeNull()
    expect(event.binding_id).toBeNull()
  })

  it('records somebody the door found but who has no password yet', async () => {
    const refused = await login({ email: SEEDED_EMAILS.lin, password })
    expect(refused.status).toBe(401)
    const event = await latestEvent()
    expect(event.reason_code).toBe('binding-not-found')
    expect(event.user_id).not.toBeNull()
    expect(event.binding_id).toBeNull()
  })

  it('records the precise reason a proven but disabled account was refused', async () => {
    await Effect.runPromise(
      runSql(sql`update users set enabled = false where id = ${userId}`).pipe(
        Effect.provide(probeInfra()),
      ),
    )
    try {
      const refused = await login({ email: SEEDED_EMAILS.ada, password })
      // the wire still says only INVALID_CREDENTIALS; the precision is the record's
      expect(refused.status).toBe(401)
      expect(await refused.json()).toMatchObject({ _tag: 'INVALID_CREDENTIALS' })
      const event = await latestEvent()
      expect(event.outcome).toBe('failure')
      expect(event.reason_code).toBe('user-disabled')
      expect(event.user_id).toBe(userId)
    } finally {
      await Effect.runPromise(
        runSql(sql`update users set enabled = true where id = ${userId}`).pipe(
          Effect.provide(probeInfra()),
        ),
      )
    }
  })
})

describe.runIf(postgresAvailable)('how many attempts a door takes', () => {
  const buckets = (scope: string) =>
    Effect.runPromise(
      runSql<{ key_hash: string; attempts: number }>(
        sql`select key_hash, attempts from auth_rate_limit_buckets where scope = ${scope}
             order by attempts`,
      ).pipe(
        Effect.map((result) => result.rows),
        Effect.provide(probeInfra()),
      ),
    )

  /**
   * The door's own service, asked directly: from one address when one is
   * given - standing in for the request the host would have read it from -
   * and from no readable address otherwise.
   */
  const admission = <A, E>(
    clientIp: string | undefined,
    body: (
      sessions: LoginSessionsShape,
      provider: ResolvedProvider,
    ) => Effect.Effect<A, E, never>,
  ) => {
    const program = Effect.gen(function* () {
      const sessions = yield* LoginSessions
      const provider = yield* sessions.resolveProvider({
        providerCode: 'password',
        expectedType: 'local',
      })
      return yield* body(sessions, provider!)
    })
    const addressed =
      clientIp === undefined
        ? program
        : program.pipe(
            Effect.provideService(RequestContext, {
              requestId: 'test',
              clientIp,
              userAgent: undefined,
              traceId: undefined,
              sessionId: undefined,
              bindSession: () => Effect.void,
              publicHost: undefined,
              endpoint: undefined,
              bindEndpoint: () => Effect.void,
            }),
          )
    return Effect.runPromise(addressed.pipe(Effect.provide(signInService)))
  }

  it('never locks an address: thirty misses, and the right password still opens it', async () => {
    for (let tried = 0; tried < 30; tried += 1) {
      const refused = await login({ email: SEEDED_EMAILS.ada, password: 'not the password' })
      expect(refused.status).toBe(401)
    }
    const opened = await login({ email: SEEDED_EMAILS.ada, password })
    expect(opened.status).toBe(200)
    // what was counted is a keyed digest, never the address typed
    for (const row of await buckets('sign-in:identifier-risk')) {
      expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(row.key_hash).not.toContain('school')
    }
  })

  it('counts an address nobody has, or one without a password, exactly like one somebody has', async () => {
    // weighed when the attempt is admitted, before anything is looked up, so
    // what is behind the address cannot change how it is counted
    for (const email of [SEEDED_EMAILS.ada, SEEDED_EMAILS.lin, 'nobody-at-all@school.edu']) {
      for (let tried = 0; tried < 3; tried += 1) {
        await login({ email, password: 'not the password' })
      }
    }
    expect((await buckets('sign-in:identifier-risk')).map((row) => row.attempts)).toEqual([3, 3, 3])
  })

  it('refuses one address past its fuse, with a wait', async () => {
    await login({ email: SEEDED_EMAILS.ada, password: 'not the password' })
    await Effect.runPromise(
      runSql(
        sql`update auth_rate_limit_buckets set attempts = 300 where scope = 'sign-in:address-hard'`,
      ).pipe(Effect.provide(probeInfra())),
    )
    const slowed = await login({ email: SEEDED_EMAILS.ada, password })
    expect(slowed.status).toBe(429)
    const retryAfter = Number(slowed.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(300)
    expect(await slowed.json()).toEqual({ _tag: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: retryAfter })
  })

  it('forgets an address once its password is proven, even for an account that may not come in', async () => {
    for (let tried = 0; tried < 3; tried += 1) {
      await login({ email: SEEDED_EMAILS.ada, password: 'not the password' })
    }
    expect(await buckets('sign-in:identifier-risk')).toHaveLength(1)
    await Effect.runPromise(
      runSql(sql`update users set enabled = false where id = ${userId}`).pipe(
        Effect.provide(probeInfra()),
      ),
    )
    try {
      // the right password for a disabled account: refused, and still not an attack
      const refused = await login({ email: SEEDED_EMAILS.ada, password })
      expect(refused.status).toBe(401)
      expect(await buckets('sign-in:identifier-risk')).toEqual([])
    } finally {
      await Effect.runPromise(
        runSql(sql`update users set enabled = true where id = ${userId}`).pipe(
          Effect.provide(probeInfra()),
        ),
      )
    }
  })

  it('admits exactly the first five of a burst at one address, and challenges the rest', async () => {
    // all of them arrive before any has been looked up: counted as they are
    // admitted, so none can read "not yet" after the fifth
    const answers = await admission('203.0.113.8', (sessions, provider) =>
      Effect.forEach(
        Array.from({ length: 30 }, (_, index) => index),
        () => sessions.admitAttempt({ provider, identifier: 'burst@school.edu' }),
        { concurrency: 'unbounded' },
      ),
    )
    expect(answers.filter((answer) => !answer.challengeRequired)).toHaveLength(5)
    expect(answers.filter((answer) => answer.challengeRequired)).toHaveLength(25)
  })

  it('challenges one address past its twentieth attempt, whoever it is trying', async () => {
    // a campus exit: many people, one address, each at their own account
    const answers = await admission('203.0.113.9', (sessions, provider) =>
      Effect.forEach(
        Array.from({ length: 22 }, (_, index) => index),
        (index) => sessions.admitAttempt({ provider, identifier: `student-${index}@school.edu` }),
      ),
    )
    expect(answers.map((answer) => answer.challengeRequired)).toEqual([
      ...Array.from({ length: 20 }, () => false),
      true,
      true,
    ])
  })

  it('treats an attempt from no readable address as raised risk, under a fuse of its own', async () => {
    const answer = await admission(undefined, (sessions, provider) =>
      sessions.admitAttempt({ provider, identifier: 'someone@school.edu' }),
    )
    expect(answer).toEqual({ challengeRequired: true })
    expect(await buckets('sign-in:unknown-address')).toHaveLength(1)
    expect(await buckets('sign-in:address-hard')).toEqual([])
  })
})
