import { Effect } from 'effect'
import { sql } from 'kysely'
import { withDatabase } from '@qualy/plugin-database/server'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import { db } from './db.ts'

// How many attempts one place, or one address, may make in a while.
//
// A fixed window per key, counted by one upsert in the database: a limit kept
// in memory would reset with every restart and count each process on its own
// the day there are two. Nothing is locked - when the window runs out, the
// count starts again - because a lock anybody can trigger by typing somebody
// else's address is a way to keep that person out.
//
// The key stored is a keyed digest of the value, so the table says nothing
// about which addresses were tried, and a digest computed elsewhere cannot be
// matched against it.

export interface LimitRule {
  /** what is being counted, and so which bucket; part of the digest too */
  readonly scope: string
  readonly limit: number
  readonly windowSeconds: number
}

/** the rules sign-in is weighed by */
export const LIMITS = {
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
} as const satisfies Record<string, LimitRule>

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

  /**
   * Counts one attempt against a key and answers whether it may proceed.
   *
   * Counted whether or not it is allowed: an attempt past the limit is still
   * an attempt, and a caller who keeps knocking keeps the window full.
   */
  const consume = Effect.fn('Auth.limiter.consume')(function* (
    tenantId: string,
    rule: LimitRule,
    key: string,
  ) {
    const keyHash = yield* secrets.fingerprint(rule.scope, key)
    const window = sql`make_interval(secs => ${rule.windowSeconds}::double precision)`
    // the existing row by its table's name, which is how an upsert refers to it
    const expired = sql<boolean>`auth_rate_limit_buckets.window_started_at <= now() - ${window}`
    const row = yield* withDb(
      db.query((k) =>
        k
          .insertInto('AuthRateLimitBucket')
          .values({
            tenantId,
            scope: rule.scope,
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
    return (
      Number(row.attempts) > rule.limit
        ? { allowed: false, retryAfterSeconds: Number(row.retryAfterSeconds) }
        : { allowed: true }
    ) satisfies LimitAnswer as LimitAnswer
  })

  return { consume, sweep }
})
