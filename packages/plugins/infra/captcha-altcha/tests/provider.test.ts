import { Effect, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { solveChallenge, type Challenge } from 'altcha-lib'
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import {
  entities as secretsEntities,
  secretsLayer,
  TEST_MASTER_KEY,
} from '@qualy/plugin-secrets/testkit'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'
import {
  CaptchaProviders,
  type CaptchaProvider,
  type CaptchaProviderContext,
} from '@qualy/plugin-captcha/server'
import { captchaPurpose } from '@qualy/plugin-captcha/contract'
import { sql } from 'kysely'
import {
  EASY_TUNING,
  entities,
  registrationLayerWith,
  type AltchaTuning,
} from '../src/testkit/index.ts'

// A proof of work, issued, solved the way a browser solves it, and checked.
//
// The challenge is made cheap - the deployment's own takes a browser a second
// or two, which a suite has no business spending - and everything else is
// what runs: the signing keys derived from the master key, the library's own
// verification, the binding to tenant, purpose and address, and the table
// that makes a proof single-use.

const context = (over: Partial<CaptchaProviderContext> = {}): CaptchaProviderContext => ({
  tenantId: '00000000-0000-4000-8000-000000000001',
  purpose: captchaPurpose('auth/login'),
  bindingHash: 'a'.repeat(64),
  clientIp: '203.0.113.8',
  publicHost: 'qualy.example.edu',
  ...over,
})

const withProvider = async <A>(
  name: string,
  body: (provider: CaptchaProvider) => Effect.Effect<A, never, Orm | Secrets>,
  tuning: AltchaTuning = EASY_TUNING,
) => {
  const db = await createTestContext(name)
  try {
    const infra = databaseFor(db.url, { entities: [...secretsEntities, ...entities] })
    const layer = registrationLayerWith(tuning).pipe(
      Layer.provideMerge(captchaLayer),
      Layer.provideMerge(secretsLayer),
      Layer.provideMerge(infra),
    )
    return await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Effect.flatMap(CaptchaProviders, (registry) => registry.selected)
        return yield* body(provider!)
      }).pipe(Effect.provide(layer)),
    )
  } finally {
    await db.dispose()
  }
}

/** what the widget sends back: the challenge as issued and its solution, as base64 JSON */
const solved = (challenge: Record<string, unknown>) =>
  Effect.promise(async () => {
    const solution = await solveChallenge({
      challenge: challenge as unknown as Challenge,
      deriveKey,
    })
    if (solution === null) throw new Error('no solution found')
    return Buffer.from(JSON.stringify({ challenge, solution })).toString('base64')
  })

describe.runIf(postgresAvailable)('the ALTCHA provider', () => {
  it('accepts the solution to a challenge it issued, once', async () => {
    const answers = await withProvider('altcha-once', (provider) =>
      Effect.gen(function* () {
        const challenge = yield* provider.issue(context())
        const proof = yield* solved(challenge)
        const first = yield* provider.verify(context(), proof)
        const replayed = yield* provider.verify(context(), proof)
        return { first, replayed }
      }).pipe(Effect.orDie),
    )
    expect(answers).toEqual({ first: 'verified', replayed: 'rejected' })
  })

  it('lets exactly one of two requests carrying the same proof through', async () => {
    const answers = await withProvider('altcha-race', (provider) =>
      Effect.gen(function* () {
        const proof = yield* solved(yield* provider.issue(context()))
        return yield* Effect.all(
          Array.from({ length: 8 }, () => provider.verify(context(), proof)),
          { concurrency: 'unbounded' },
        )
      }).pipe(Effect.orDie),
    )
    expect(answers.filter((answer) => answer === 'verified')).toHaveLength(1)
    expect(answers.filter((answer) => answer === 'rejected')).toHaveLength(7)
  })

  it('refuses a proof spent on another tenant, purpose or address', async () => {
    const answers = await withProvider('altcha-binding', (provider) =>
      Effect.gen(function* () {
        const proofFor = () => Effect.flatMap(provider.issue(context()), solved)
        return {
          tenant: yield* provider.verify(
            context({ tenantId: '00000000-0000-4000-8000-000000000002' }),
            yield* proofFor(),
          ),
          purpose: yield* provider.verify(
            context({ purpose: captchaPurpose('auth/password-reset') }),
            yield* proofFor(),
          ),
          binding: yield* provider.verify(
            context({ bindingHash: 'b'.repeat(64) }),
            yield* proofFor(),
          ),
        }
      }).pipe(Effect.orDie),
    )
    expect(answers).toEqual({ tenant: 'rejected', purpose: 'rejected', binding: 'rejected' })
  })

  it('refuses a challenge whose signed data was changed, and one that expired', async () => {
    const answers = await withProvider('altcha-tampered', (provider) =>
      Effect.gen(function* () {
        const challenge = (yield* provider.issue(context())) as {
          parameters: { data: Record<string, unknown> }
        }
        // the data rewritten to name another binding, the solution still real
        const moved = {
          ...challenge,
          parameters: {
            ...challenge.parameters,
            data: { ...challenge.parameters.data, bindingHash: 'b'.repeat(64) },
          },
        }
        const tampered = yield* provider.verify(
          context({ bindingHash: 'b'.repeat(64) }),
          yield* solved(moved),
        )
        const garbage = yield* provider.verify(context(), 'not a payload at all')
        const oversized = yield* provider.verify(context(), 'x'.repeat(5000))
        return { tampered, garbage, oversized }
      }).pipe(Effect.orDie),
    )
    expect(answers).toEqual({ tampered: 'rejected', garbage: 'rejected', oversized: 'rejected' })
    const expired = await withProvider(
      'altcha-expired',
      (provider) =>
        Effect.gen(function* () {
          return yield* provider.verify(context(), yield* solved(yield* provider.issue(context())))
        }).pipe(Effect.orDie),
      { ...EASY_TUNING, ttlMs: -60_000 },
    )
    expect(expired).toBe('rejected')
  })

  it('signs with two keys of its own, neither the other nor the master key', async () => {
    const [challenge, key] = await withProvider('altcha-keys', () =>
      Effect.gen(function* () {
        const secrets = yield* Secrets
        return [
          Redacted.value(yield* secrets.deriveSecret('captcha/altcha/challenge/v1')),
          Redacted.value(yield* secrets.deriveSecret('captcha/altcha/key/v1')),
        ] as const
      }),
    )
    expect(challenge).not.toBe(key)
    const master = Buffer.from(TEST_MASTER_KEY, 'base64').toString('base64url')
    expect([challenge, key]).not.toContain(master)
  })

  it('forgets spent challenges a while after they expired', async () => {
    const rows = await withProvider('altcha-sweep', (provider) =>
      Effect.gen(function* () {
        const proof = yield* solved(yield* provider.issue(context()))
        yield* provider.verify(context(), proof)
        yield* runSql(
          sql`update captcha_altcha_used_challenges set expires_at = now() - interval '2 hours'`,
        )
        // the sweep rides along every hundredth accepted proof: ninety-nine
        // more bring the count to a hundred
        for (let index = 0; index < 99; index += 1) {
          yield* provider.verify(context(), yield* solved(yield* provider.issue(context())))
        }
        const left = yield* runSql<{ count: number }>(
          sql`select count(*)::int as count from captcha_altcha_used_challenges
               where expires_at < now() - interval '1 hour'`,
        )
        return left.rows[0]!.count
      }).pipe(Effect.orDie),
    )
    expect(rows).toBe(0)
  })
})
