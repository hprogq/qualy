import { Effect, Layer } from 'effect'
import type { Orm } from '@qualy/plugin-database/server'
import { sql } from 'kysely'
import { describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { makeLimiter, type HardLimitRule, type RiskRule } from '../src/server/limiter.ts'
import { authClosure } from './support/closure.ts'

// What a count is allowed to mean. A hard limit refuses, with a wait; a risk
// rule only says whether this attempt - or the next one - should first be
// challenged, and never refuses anything. The two answer on either side of
// one boundary, so the boundary is pinned attempt by attempt.

const hard: HardLimitRule = { scope: 'test:hard', limit: 3, windowSeconds: 300 }
const risk: RiskRule = { scope: 'test:risk', challengeAfter: 5, windowSeconds: 300 }

const withLimiter = async <A>(
  name: string,
  body: (
    limiter: Effect.Success<typeof makeLimiter>,
    tenantId: string,
  ) => Effect.Effect<A, never, Orm>,
) => {
  const db = await createTestContext(name)
  try {
    const layer = secretsLayer.pipe(
      Layer.provideMerge(databaseFor(db.url, { entities: authClosure })),
    )
    return await Effect.runPromise(
      Effect.gen(function* () {
        const tenant = (yield* runSql<{ id: string }>(
          sql`insert into tenants (slug, name) values ('default', 'D') returning id`,
        )).rows[0]!.id
        const limiter = yield* makeLimiter
        return yield* body(limiter, tenant)
      }).pipe(Effect.provide(layer)),
    )
  } finally {
    await db.dispose()
  }
}

/** moves every window back past its end, as time would */
const expire = runSql(
  sql`update auth_rate_limit_buckets set window_started_at = now() - interval '1 hour'`,
)

describe.runIf(postgresAvailable)('the sign-in limiter', () => {
  it('refuses past a hard limit, with the wait until its window ends', async () => {
    const answers = await withLimiter('limiter-hard', (limiter, tenant) =>
      Effect.forEach([1, 2, 3, 4], () => limiter.consumeHard(tenant, hard, 'a')),
    )
    expect(answers.slice(0, 3)).toEqual([{ allowed: true }, { allowed: true }, { allowed: true }])
    expect(answers[3]).toMatchObject({ allowed: false })
    const wait = (answers[3] as { retryAfterSeconds: number }).retryAfterSeconds
    expect(wait).toBeGreaterThan(0)
    expect(wait).toBeLessThanOrEqual(300)
  })

  it('challenges the attempt after the first five, and never refuses one', async () => {
    const observed = await withLimiter('limiter-observe', (limiter, tenant) =>
      Effect.forEach([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], () => limiter.observeRisk(tenant, risk, 'a')),
    )
    expect(observed.map((answer) => answer.challengeRequired)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ])
    expect(observed.map((answer) => answer.attempts)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('asks about the next attempt without counting one', async () => {
    const answers = await withLimiter('limiter-required', (limiter, tenant) =>
      Effect.gen(function* () {
        const before = yield* limiter.riskRequired(tenant, risk, 'a')
        yield* Effect.forEach([1, 2, 3, 4], () => limiter.observeRisk(tenant, risk, 'a'))
        const afterFour = yield* limiter.riskRequired(tenant, risk, 'a')
        yield* limiter.observeRisk(tenant, risk, 'a')
        // asked twice: counting nothing, the answer does not move
        const afterFive = yield* limiter.riskRequired(tenant, risk, 'a')
        const again = yield* limiter.riskRequired(tenant, risk, 'a')
        // the sixth is the one that would be challenged, and asking did not use it up
        const sixth = yield* limiter.observeRisk(tenant, risk, 'a')
        return { before, afterFour, afterFive, again, sixth }
      }),
    )
    expect(answers).toEqual({
      before: false,
      afterFour: false,
      afterFive: true,
      again: true,
      sixth: { attempts: 6, challengeRequired: true },
    })
  })

  it('starts over once the window has passed, or once it is cleared', async () => {
    const answers = await withLimiter('limiter-reset', (limiter, tenant) =>
      Effect.gen(function* () {
        yield* Effect.forEach([1, 2, 3, 4, 5, 6], () => limiter.observeRisk(tenant, risk, 'a'))
        yield* expire
        const expired = yield* limiter.riskRequired(tenant, risk, 'a')
        const restarted = yield* limiter.observeRisk(tenant, risk, 'a')
        yield* Effect.forEach([1, 2, 3, 4, 5], () => limiter.observeRisk(tenant, risk, 'b'))
        yield* limiter.clearRisk(tenant, risk, 'b')
        const cleared = yield* limiter.riskRequired(tenant, risk, 'b')
        // one key's count is its own
        const other = yield* limiter.observeRisk(tenant, risk, 'c')
        return { expired, restarted, cleared, other }
      }),
    )
    expect(answers).toEqual({
      expired: false,
      restarted: { attempts: 1, challengeRequired: false },
      cleared: false,
      other: { attempts: 1, challengeRequired: false },
    })
  })

  it('admits exactly the first five of a burst that arrives at once', async () => {
    const observed = await withLimiter('limiter-burst', (limiter, tenant) =>
      Effect.forEach(
        Array.from({ length: 40 }, (_, index) => index),
        () => limiter.observeRisk(tenant, risk, 'a'),
        { concurrency: 'unbounded' },
      ),
    )
    expect(observed.filter((answer) => !answer.challengeRequired)).toHaveLength(5)
    expect(observed.filter((answer) => answer.challengeRequired)).toHaveLength(35)
  })
})
