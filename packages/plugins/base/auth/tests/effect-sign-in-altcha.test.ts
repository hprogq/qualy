import { sql } from 'kysely'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { solveChallenge, type Challenge } from 'altcha-lib'
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2'
import { postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'
import {
  EASY_TUNING,
  entities as altchaEntities,
  registrationLayerWith,
} from '@qualy/plugin-captcha-altcha/testkit'
import { SEEDED_EMAILS } from './support/sign-in-seed.ts'
import {
  SIGN_IN_PASSWORD as password,
  startSignInServer,
  type SignInServer,
} from './support/sign-in-server.ts'

// The whole chain, with the provider a deployment runs: a password door that
// asks for a challenge, the real ALTCHA provider issuing it, altcha-lib
// solving it the way the widget's worker does, and the same request sent
// again with the proof. Only the difficulty is the suite's own.

let server: SignInServer

beforeAll(async () => {
  if (!postgresAvailable) return
  server = await startSignInServer({
    name: 'effect-sign-in-altcha',
    port: 3227,
    captcha: registrationLayerWith(EASY_TUNING).pipe(Layer.provideMerge(captchaLayer)),
    entities: altchaEntities,
  })
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await server.close()
})

beforeEach(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(
    runSql(sql`delete from auth_rate_limit_buckets`).pipe(Effect.provide(server.probeInfra())),
  )
})

const login = async (body: {
  email: string
  password: string
  captcha?: { provider: string; response: string }
}) => {
  const response = await fetch(`${server.base}/auth/local/password/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

/** what the widget sends back once its worker has found the counter */
const solve = async (challenge: unknown) => {
  const solution = await solveChallenge({ challenge: challenge as Challenge, deriveKey })
  if (solution === null) throw new Error('no solution')
  return {
    provider: 'altcha',
    response: Buffer.from(JSON.stringify({ challenge, solution })).toString('base64'),
  }
}

describe.runIf(postgresAvailable)('signing in through an ALTCHA challenge', () => {
  it('asks, is answered with a solved challenge, and lets the right password in', async () => {
    for (let tried = 0; tried < 5; tried += 1) {
      expect((await login({ email: SEEDED_EMAILS.ada, password: 'not the password' })).status).toBe(
        401,
      )
    }
    const asked = await login({ email: SEEDED_EMAILS.ada, password })
    expect(asked.status).toBe(428)
    expect(asked.body).toMatchObject({ _tag: 'CAPTCHA_REQUIRED', provider: 'altcha' })
    const proof = await solve(asked.body['challenge'])
    const opened = await login({ email: SEEDED_EMAILS.ada, password, captcha: proof })
    expect(opened.status).toBe(200)
    // spent: the same proof, again, is asked about afresh
    for (let tried = 0; tried < 5; tried += 1) {
      await login({ email: SEEDED_EMAILS.ada, password: 'not the password' })
    }
    const replayed = await login({ email: SEEDED_EMAILS.ada, password, captcha: proof })
    expect(replayed.status).toBe(428)
  })

  it('will not let a proof solved for one address open another', async () => {
    for (const email of [SEEDED_EMAILS.ada, SEEDED_EMAILS.lin]) {
      for (let tried = 0; tried < 5; tried += 1) {
        await login({ email, password: 'not the password' })
      }
    }
    const forLin = await login({ email: SEEDED_EMAILS.lin, password })
    const proof = await solve(forLin.body['challenge'])
    const spent = await login({ email: SEEDED_EMAILS.ada, password, captcha: proof })
    expect(spent.status).toBe(428)
  })
})
