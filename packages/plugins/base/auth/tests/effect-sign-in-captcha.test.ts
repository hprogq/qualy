import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'kysely'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
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
import { sessionCookieName } from '@qualy/auth-contract/session'
import { hashPassword } from '@qualy/plugin-auth-local/password'
import { apiHandlers as authLocalApiHandlers, driver as localDriver } from '@qualy/plugin-auth-local'
import { authLocalApiGroup } from '@qualy/plugin-auth-local/api'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayerWith } from '@qualy/plugin-captcha/testkit'
import type { CaptchaProvider } from '@qualy/plugin-captcha/server'
import { sessionApiGroup } from '../src/api.ts'
import { sessionApiHandlers } from '../src/server/index.ts'
import { AuthConfig, layer as signInLayer } from '../src/server/sign-in.ts'
import { layer as sessionLayer } from '../src/server/session.ts'
import { singleTenantLayer } from '../src/server/tenancy.ts'
import { singleOriginLayer } from '../src/server/public-origin.ts'
import { SEEDED_EMAILS, seedSignIn } from './support/sign-in-seed.ts'
import { authClosure } from './support/closure.ts'
import { authAuditLayer } from './support/audit.ts'
import { unusedEmailFlows } from './support/email-flows.ts'

// Signing in where a challenge can be asked for.
//
// A provider that stands in for a real one: its challenge names the binding
// it was issued for, and its proof is that binding, so a proof earned for one
// address is visibly worth nothing for another. It counts what it was asked,
// which is how a proof that was never needed is shown not to have been
// checked.

const port = 3223
const base = `http://127.0.0.1:${port}${QUALY_API_PREFIX}`
const api = Api.local(sessionApiGroup, authLocalApiGroup)
const password = 'correct horse battery staple'

const asked = { issue: 0, verify: 0 }
const fake: CaptchaProvider = {
  code: 'fake',
  issue: (context) =>
    Effect.sync(() => {
      asked.issue += 1
      return { binding: context.bindingHash }
    }),
  verify: (context, response) =>
    Effect.sync(() => {
      asked.verify += 1
      return response === `solved:${context.bindingHash}` ? 'verified' : 'rejected'
    }),
}

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>
/** the sign-in service as the server was given it, for asking it directly */
let signInService: Layer.Layer<LoginSessions, unknown>

beforeAll(async () => {
  if (!postgresAvailable) return
  db = await createTestContext('effect-sign-in-captcha')
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
  const signIn = signInLayer.pipe(
    Layer.provide(captchaLayerWith(fake)),
    Layer.provide(secretsLayer),
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
  const hash = await hashPassword(password)
  await Effect.runPromise(seedSignIn(hash).pipe(Effect.provide(infra)))
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope, Exit.void))
  await db.dispose()
})

const probeInfra = () => databaseFor(db.url, { migrations: 'off', entities: authClosure })

beforeEach(async () => {
  if (!postgresAvailable) return
  asked.issue = 0
  asked.verify = 0
  await Effect.runPromise(
    runSql(sql`delete from auth_rate_limit_buckets`).pipe(Effect.provide(probeInfra())),
  )
})

interface Answer {
  readonly status: number
  readonly tag: string | undefined
  readonly challenge: { readonly binding?: string } | undefined
}

const login = async (body: {
  email: string
  password: string
  captcha?: { provider: string; response: string }
}): Promise<Answer> => {
  const response = await fetch(`${base}/auth/local/password/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as {
    _tag?: string
    challenge?: { binding?: string }
  }
  return { status: response.status, tag: payload._tag, challenge: payload.challenge }
}

/** the proof the stand-in accepts for a challenge */
const solve = (answer: Answer) => ({
  provider: 'fake',
  response: `solved:${answer.challenge?.binding ?? ''}`,
})

describe.runIf(postgresAvailable)('signing in where a challenge can be asked for', () => {
  it('asks the same of every address after five attempts, whoever is behind it', async () => {
    // somebody with a password, somebody without one, and nobody at all:
    // the same five refusals, then the same challenge
    for (const email of [SEEDED_EMAILS.ada, SEEDED_EMAILS.lin, 'nobody-at-all@school.edu']) {
      const statuses: number[] = []
      for (let tried = 0; tried < 6; tried += 1) {
        statuses.push((await login({ email, password: 'not the password' })).status)
      }
      expect(statuses, email).toEqual([401, 401, 401, 401, 401, 428])
    }
  })

  it('answers a challenge with the same request and a proof, one attempt per proof', async () => {
    for (let tried = 0; tried < 5; tried += 1) {
      await login({ email: SEEDED_EMAILS.ada, password: 'not the password' })
    }
    const challenged = await login({ email: SEEDED_EMAILS.ada, password })
    expect(challenged).toMatchObject({ status: 428, tag: 'CAPTCHA_REQUIRED' })
    // a met challenge lets the password be judged - and a wrong one is still wrong
    const judged = await login({
      email: SEEDED_EMAILS.ada,
      password: 'still not it',
      captcha: solve(challenged),
    })
    expect(judged).toMatchObject({ status: 401, tag: 'INVALID_CREDENTIALS' })
    // the proof bought that one attempt and cleared nothing
    const again = await login({ email: SEEDED_EMAILS.ada, password })
    expect(again.status).toBe(428)
    const opened = await login({ email: SEEDED_EMAILS.ada, password, captcha: solve(again) })
    expect(opened.status).toBe(200)
    // and the right password is what clears it
    expect((await login({ email: SEEDED_EMAILS.ada, password })).status).toBe(200)
  })

  it('answers a proof earned for another address with a fresh challenge', async () => {
    for (const email of [SEEDED_EMAILS.ada, SEEDED_EMAILS.lin]) {
      for (let tried = 0; tried < 5; tried += 1) {
        await login({ email, password: 'not the password' })
      }
    }
    const forLin = await login({ email: SEEDED_EMAILS.lin, password })
    const spent = await login({ email: SEEDED_EMAILS.ada, password, captcha: solve(forLin) })
    expect(spent).toMatchObject({ status: 428, tag: 'CAPTCHA_REQUIRED' })
    expect(spent.challenge?.binding).not.toBe(forLin.challenge?.binding)
  })

  it('does not look at a proof nothing asked for', async () => {
    const answer = await login({
      email: SEEDED_EMAILS.ada,
      password,
      captcha: { provider: 'fake', response: 'solved:anything' },
    })
    expect(answer.status).toBe(200)
    expect(asked).toEqual({ issue: 0, verify: 0 })
  })

  it('challenges a busy address rather than refusing it', async () => {
    // a campus exit: many people, one address, each at their own account
    const statuses: number[] = []
    for (let index = 0; index < 22; index += 1) {
      statuses.push(
        (await login({ email: `student-${index}@school.edu`, password: 'not the password' })).status,
      )
    }
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true)
    expect(statuses.slice(20)).toEqual([428, 428])
  })
})

describe.runIf(postgresAvailable)('admitting an attempt', () => {
  /**
   * The door's own service, asked directly: from one address when one is
   * given - standing in for the request the host would have read it from -
   * and from no readable address otherwise.
   */
  const admission = <A, E>(
    clientIp: string | undefined,
    body: (sessions: LoginSessionsShape, provider: ResolvedProvider) => Effect.Effect<A, E, never>,
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

  const buckets = (scope: string) =>
    Effect.runPromise(
      runSql<{ attempts: number }>(
        sql`select attempts from auth_rate_limit_buckets where scope = ${scope}`,
      ).pipe(
        Effect.map((result) => result.rows),
        Effect.provide(probeInfra()),
      ),
    )

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
    expect(answers.filter((answer) => answer.kind === 'admitted')).toHaveLength(5)
    expect(answers.filter((answer) => answer.kind === 'challenge')).toHaveLength(25)
  })

  it('challenges an attempt from no readable address, under a fuse of its own', async () => {
    const answer = await admission(undefined, (sessions, provider) =>
      sessions.admitAttempt({ provider, identifier: 'someone@school.edu' }),
    )
    expect(answer).toMatchObject({ kind: 'challenge', prompt: { provider: 'fake' } })
    expect(await buckets('sign-in:unknown-address')).toHaveLength(1)
    expect(await buckets('sign-in:address-hard')).toEqual([])
  })
})
