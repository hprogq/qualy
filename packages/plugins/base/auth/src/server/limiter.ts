import { Effect } from 'effect'
import { sql } from 'kysely'
import { withDatabase } from '@qualy/plugin-database/server'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import { db } from './db.ts'

// How many attempts one place, or one address, has made in a while - and
// what that is allowed to mean.
//
// A fixed window per key, counted by one upsert in the database: a limit kept
// in memory would reset with every restart and count each process on its own
// the day there are two. The key stored is a keyed digest of the value, so
// the table says nothing about which addresses were tried, and a digest
// computed elsewhere cannot be matched against it.
//
// A count answers one of two questions, and the types keep them apart:
//
// - a hard limit refuses, with a wait. It is for resources - how much hashing
//   one network exit may ask for, how many mails one address may be sent -
//   and is set wide, because behind one campus address stand hundreds of
//   people.
// - a risk rule only ever answers whether the next attempt should first be
//   made to pay for itself with a challenge. It can never refuse. An
//   identifier is weighed this way and only this way: a limit anybody can
//   fill by typing somebody else's address is a way to keep that person out.

export interface HardLimitRule {
  /** what is being counted, and so which bucket; part of the digest too */
  readonly scope: string
  readonly limit: number
  readonly windowSeconds: number
}

export interface RiskRule {
  /** what is being counted, and so which bucket; part of the digest too */
  readonly scope: string
  /** the first this many observations in a window go unchallenged; the one after does not */
  readonly challengeAfter: number
  readonly windowSeconds: number
}

/** the limits that refuse */
export const HARD_LIMITS = {
  /** attempts from one address at one entrance */
  signInByAddress: { scope: 'sign-in:address', limit: 30, windowSeconds: 300 },
  /** attempts at one identifier - an email - at one entrance, from anywhere */
  signInByIdentifier: { scope: 'sign-in:identifier', limit: 10, windowSeconds: 900 },
  /** redirects started from one address at one entrance */
  flowStartByAddress: { scope: 'flow-start:address', limit: 30, windowSeconds: 300 },
  /** forgotten-password requests from one address */
  resetByAddress: { scope: 'reset:address', limit: 10, windowSeconds: 900 },
  /** forgotten-password requests for one email, from anywhere */
  resetByIdentifier: { scope: 'reset:identifier', limit: 3, windowSeconds: 3600 },
  /** links one person asks to be sent to themselves */
  mailBySelf: { scope: 'mail:user', limit: 5, windowSeconds: 3600 },
  /** tries at one person's own current password */
  passwordBySelf: { scope: 'password:user', limit: 10, windowSeconds: 900 },
} as const satisfies Record<string, HardLimitRule>

/** the rules that ask for a challenge */
export const RISK_RULES = {} as const satisfies Record<string, RiskRule>

/** buckets nobody has touched for this long are swept */
const SWEEP_AFTER_HOURS = 24
/** at most this many per sweep, so one sweep is never a scan */
const SWEEP_LIMIT = 500
/** a sweep rides along every this many counts, in each process */
const SWEEP_EVERY = 100

export type LimitAnswer =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number }

export const makeLimiter = Effect.gen(function* () {
  const withDb = yield* withDatabase
  const secrets = yield* Secrets
  let counted = 0

  const sweep = withDb(
    db.query((k) =>
      sql`
        delete from auth_rate_limit_buckets
         where ctid in (
           select ctid from auth_rate_limit_buckets
            where updated_at < now() - ${sql.raw(`interval '${String(SWEEP_AFTER_HOURS)} hours'`)}
            limit ${SWEEP_LIMIT}
         )`.execute(k),
    ),
  ).pipe(Effect.orDie, Effect.asVoid)

  /** one more in the key's window - a new window when the last has run out - and where it stands */
  const count = Effect.fnUntraced(function* (
    tenantId: string,
    scope: string,
    windowSeconds: number,
    key: string,
  ) {
    const keyHash = yield* secrets.fingerprint(scope, key)
    const window = sql`make_interval(secs => ${windowSeconds}::double precision)`
    // the existing row by its table's name, which is how an upsert refers to it
    const expired = sql<boolean>`auth_rate_limit_buckets.window_started_at <= now() - ${window}`
    const row = yield* withDb(
      db.query((k) =>
        k
          .insertInto('AuthRateLimitBucket')
          .values({
            tenantId,
            scope,
            keyHash,
            windowStartedAt: sql<Date>`now()`,
            attempts: 1,
            updatedAt: sql<Date>`now()`,
          } as never)
          .onConflict((conflict) =>
            conflict.columns(['tenantId', 'scope', 'keyHash']).doUpdateSet({
              windowStartedAt: sql<Date>`case when ${expired} then now() else auth_rate_limit_buckets.window_started_at end`,
              attempts: sql<number>`case when ${expired} then 1 else auth_rate_limit_buckets.attempts + 1 end`,
              updatedAt: sql<Date>`now()`,
            } as never),
          )
          .returning([
            'attempts',
            sql<number>`greatest(1, ceil(extract(epoch from (window_started_at + ${window} - now()))))::int`.as(
              'retryAfterSeconds',
            ),
          ])
          .executeTakeFirstOrThrow(),
      ),
    ).pipe(Effect.orDie)
    counted += 1
    if (counted % SWEEP_EVERY === 0) yield* sweep
    return { attempts: Number(row.attempts), retryAfterSeconds: Number(row.retryAfterSeconds) }
  })

  /**
   * Counts one attempt against a hard limit and answers whether it may proceed.
   *
   * Counted whether or not it is allowed: an attempt past the limit is still
   * an attempt, and a caller who keeps knocking keeps the window full.
   */
  const consumeHard = Effect.fn('Auth.limiter.consumeHard')(function* (
    tenantId: string,
    rule: HardLimitRule,
    key: string,
  ) {
    const row = yield* count(tenantId, rule.scope, rule.windowSeconds, key)
    return (
      row.attempts > rule.limit
        ? { allowed: false, retryAfterSeconds: row.retryAfterSeconds }
        : { allowed: true }
    ) satisfies LimitAnswer as LimitAnswer
  })

  /**
   * Counts one attempt against every hard limit and answers with the longest
   * wait.
   *
   * Every bucket is counted, and the refusal names the wait until all of them
   * would let the attempt through: answering with whichever refused first
   * told a caller held for fifteen minutes by one bucket to come back in five
   * because another had filled too.
   */
  const consumeAllHard = Effect.fn('Auth.limiter.consumeAllHard')(function* (
    tenantId: string,
    weighed: ReadonlyArray<readonly [rule: HardLimitRule, key: string]>,
  ) {
    let wait = 0
    for (const [rule, key] of weighed) {
      const answer = yield* consumeHard(tenantId, rule, key)
      if (!answer.allowed) wait = Math.max(wait, answer.retryAfterSeconds)
    }
    return (
      wait > 0 ? { allowed: false, retryAfterSeconds: wait } : { allowed: true }
    ) satisfies LimitAnswer as LimitAnswer
  })

  /**
   * Counts THIS attempt against a risk rule, and answers whether this attempt
   * must first be challenged: `attempts > challengeAfter`, the count now
   * including the one being made.
   *
   * The count and the answer are one atomic statement, which is the point:
   * a burst of attempts that all arrive before any has finished cannot all
   * read "not yet" - the first `challengeAfter` of them are admitted and
   * every one after that is challenged, however close together they came.
   */
  const observeRisk = Effect.fn('Auth.limiter.observeRisk')(function* (
    tenantId: string,
    rule: RiskRule,
    key: string,
  ) {
    const row = yield* count(tenantId, rule.scope, rule.windowSeconds, key)
    return { attempts: row.attempts, challengeRequired: row.attempts > rule.challengeAfter }
  })

  /**
   * Whether the NEXT attempt at this key would be challenged, counting
   * nothing: `attempts >= challengeAfter`, because the next observation would
   * make it one more. For a caller that counts in one place and asks in
   * another; an attempt that is counted where it is asked uses `observeRisk`.
   */
  const riskRequired = Effect.fn('Auth.limiter.riskRequired')(function* (
    tenantId: string,
    rule: RiskRule,
    key: string,
  ) {
    const keyHash = yield* secrets.fingerprint(rule.scope, key)
    const window = sql`make_interval(secs => ${rule.windowSeconds}::double precision)`
    const row = yield* withDb(
      db.query((k) =>
        k
          .selectFrom('AuthRateLimitBucket')
          .select('attempts')
          .where('tenantId', '=', tenantId)
          .where('scope', '=', rule.scope)
          .where('keyHash', '=', keyHash)
          .where(sql<boolean>`window_started_at > now() - ${window}`)
          .executeTakeFirst(),
      ),
    ).pipe(Effect.orDie)
    return row !== undefined && Number(row.attempts) >= rule.challengeAfter
  })

  /** forgets what a risk rule counted for one key: the attempts it weighed ended well */
  const clearRisk = Effect.fn('Auth.limiter.clearRisk')(function* (
    tenantId: string,
    rule: RiskRule,
    key: string,
  ) {
    const keyHash = yield* secrets.fingerprint(rule.scope, key)
    yield* withDb(
      db.query((k) =>
        k
          .deleteFrom('AuthRateLimitBucket')
          .where('tenantId', '=', tenantId)
          .where('scope', '=', rule.scope)
          .where('keyHash', '=', keyHash)
          .execute(),
      ),
    ).pipe(Effect.orDie)
  })

  return { consumeHard, consumeAllHard, observeRisk, riskRequired, clearRisk, sweep }
})
