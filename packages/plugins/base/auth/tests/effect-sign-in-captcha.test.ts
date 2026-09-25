import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { RequestContext } from '@qualy/api-kit/request'
import {
  LoginSessions,
  type LoginSessionsShape,
  type ResolvedProvider,
} from '@qualy/auth-contract/login'
import { captchaLayerWith } from '@qualy/plugin-captcha/testkit'
import type { CaptchaProvider } from '@qualy/plugin-captcha/server'
import { RISK_RULES } from '../src/server/limiter.ts'
import { SEEDED_EMAILS } from './support/sign-in-seed.ts'
import {
  SIGN_IN_PASSWORD as password,
  startSignInServer,
  type SignInServer,
} from './support/sign-in-server.ts'

// Signing in where a challenge can be asked for.
//
// A provider that stands in for a real one: its challenge names the binding
// it was issued for, and its proof is that binding, so a proof earned for one
// address is visibly worth nothing for another. It counts what it was asked,
// which is how a proof that was never needed is shown not to have been
// checked.

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

let server: SignInServer

beforeAll(async () => {
  if (!postgresAvailable) return
  server = await startSignInServer({
    name: 'effect-sign-in-captcha',
    port: 3223,
    captcha: captchaLayerWith(fake),
  })
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await server.close()
})

const probeInfra = () => server.probeInfra()

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
  const response = await fetch(`${server.base}/auth/local/password/login`, {
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
        (await login({ email: `student-${index}@school.edu`, password: 'not the password' }))
          .status,
      )
    }
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true)
    expect(statuses.slice(20)).toEqual([428, 428])
  })
})

describe.runIf(postgresAvailable)('admitting an attempt', () => {
  /** as though the request came from this address, read as the host would have read it */
  const from =
    (clientIp: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(RequestContext, {
          // an id as the request pipeline mints one: a failure's record keeps it
          requestId: '00000000-0000-7000-8000-000000000000',
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
    const addressed = clientIp === undefined ? program : program.pipe(from(clientIp))
    return Effect.runPromise(addressed.pipe(Effect.provide(server.signInService)))
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

  it('counts an IPv6 address as its /64, and an IPv4 address as itself', async () => {
    const { challengeAfter } = RISK_RULES.signInByAddressRisk
    const answers = await admission(undefined, (sessions, provider) =>
      Effect.gen(function* () {
        const admit = (clientIp: string, identifier: string) =>
          sessions.admitAttempt({ provider, identifier }).pipe(
            from(clientIp),
            Effect.map((answer) => answer.kind),
          )
        // one machine walking its /64, a fresh address and a fresh identifier each time
        const walked: string[] = []
        for (let index = 1; index <= challengeAfter + 1; index += 1) {
          walked.push(yield* admit(`2001:db8:1:2::${index.toString(16)}`, `walk-${index}@x.edu`))
        }
        // the /64 next door is somebody else
        const neighbour = yield* admit('2001:db8:1:3::1', 'neighbour@x.edu')
        const exact: string[] = []
        for (let index = 1; index <= challengeAfter + 1; index += 1) {
          exact.push(yield* admit('198.51.100.7', `v4-${index}@x.edu`))
        }
        const nextDoor = yield* admit('198.51.100.8', 'v4-next@x.edu')
        return { walked, neighbour, exact, nextDoor }
      }),
    )
    const admitted = Array.from({ length: challengeAfter }, () => 'admitted')
    expect(answers).toEqual({
      walked: [...admitted, 'challenge'],
      neighbour: 'admitted',
      exact: [...admitted, 'challenge'],
      nextDoor: 'admitted',
    })
  })

  it('challenges everybody at an entrance for the rest of a window that saw too many wrong credentials, and only for that window', async () => {
    const { scope, challengeAfter, windowSeconds } = RISK_RULES.signInFailuresByEntranceRisk
    const window = () =>
      Effect.runPromise(
        runSql<{ started: string; attempts: number }>(
          sql`select window_started_at::text as started, attempts
                from auth_rate_limit_buckets where scope = ${scope}`,
        ).pipe(
          Effect.map((result) => result.rows),
          Effect.provide(probeInfra()),
        ),
      )
    /** wrong credentials, each from an address of its own, none near that address's count */
    const failing = (count: number) => (sessions: LoginSessionsShape, provider: ResolvedProvider) =>
      Effect.forEach(
        Array.from({ length: count }, (_, index) => index),
        (index) =>
          sessions
            .failAttempt(provider, {
              reason: index % 2 === 0 ? 'user-not-found' : 'invalid-credentials',
            })
            .pipe(from(`192.0.2.${(index % 250) + 1}`)),
        { concurrency: 8, discard: true },
      )
    /** an attempt nothing else would challenge: a new network, a new identifier */
    const fresh = (sessions: LoginSessionsShape, provider: ResolvedProvider, at: string) =>
      sessions.admitAttempt({ provider, identifier: `${at}@x.edu` }).pipe(
        from(`2001:db8:9:${at.length}::1`),
        Effect.map((answer) => answer.kind),
      )

    // an account's own refusal is not a wrong credential
    await admission(undefined, (sessions, provider) =>
      sessions.failAttempt(provider, { reason: 'user-disabled' }),
    )
    expect(await window()).toEqual([])

    const raised = await admission(undefined, (sessions, provider) =>
      Effect.gen(function* () {
        yield* failing(challengeAfter - 1)(sessions, provider)
        const below = yield* fresh(sessions, provider, 'below')
        yield* failing(1)(sessions, provider)
        return { below, at: yield* fresh(sessions, provider, 'at') }
      }),
    )
    expect(raised).toEqual({ below: 'admitted', at: 'challenge' })
    const [opened] = await window()

    // the failures go on; the window they fall in does not move
    const still = await admission(undefined, (sessions, provider) =>
      Effect.gen(function* () {
        yield* failing(40)(sessions, provider)
        return yield* fresh(sessions, provider, 'still')
      }),
    )
    expect(still).toBe('challenge')
    const [kept] = await window()
    expect(kept!.started).toBe(opened!.started)
    expect(kept!.attempts).toBe(challengeAfter + 40)

    // the window's own length after it began it is over, and the next one
    // starts from nothing
    await Effect.runPromise(
      runSql(sql`
        update auth_rate_limit_buckets
           set window_started_at = window_started_at - make_interval(secs => ${windowSeconds})
         where scope = ${scope}`).pipe(Effect.provide(probeInfra())),
    )
    const after = await admission(undefined, (sessions, provider) =>
      Effect.gen(function* () {
        const over = yield* fresh(sessions, provider, 'over')
        yield* failing(1)(sessions, provider)
        return { over, next: yield* fresh(sessions, provider, 'next') }
      }),
    )
    expect(after).toEqual({ over: 'admitted', next: 'admitted' })
    expect((await window()).map((row) => row.attempts)).toEqual([1])
  })
})
