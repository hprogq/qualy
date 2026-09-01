import { AsyncLocalStorage } from 'node:async_hooks'
import { Client, type Pool, type PoolClient } from 'pg'
import { Effect } from 'effect'

// Who is holding each connection the pool has handed out.
//
// A pool closes when every connection has come back, and one that never does
// makes the whole shutdown wait. The pool's own counters can say that a
// connection is out; they cannot say whose it is, what it was doing, or what
// the server thinks of it. This ledger answers the first two from the effect
// that asked, and `describeBackends` asks the server the third.
//
// Attribution rides AsyncLocalStorage from `transaction`/`query` into the
// pool's acquire, and it is the returned client that gets tagged - not the
// pool's 'acquire' event. Measured: that event fires inside the pulse that
// hands a queued waiter the client its predecessor just released, in the
// releaser's async context, so under a saturated pool it names the wrong
// caller. The client the promise resolves with is the only exact anchor.

export interface CheckoutOwner {
  readonly kind: 'transaction' | 'query'
  /** the checkout's identity, so a release that failed can still find its client */
  readonly token: object
  readonly fiber: number | undefined
  /** the caller's span, when there is one */
  readonly span: string | undefined
  /** the plugin the fiber was working for */
  readonly source: string | undefined
}

export interface Checkout {
  readonly owner: CheckoutOwner | undefined
  readonly since: number
  /** the server-side process, once the client has said hello */
  readonly pid: number | null
}

/** the owner a checkout is attributed to, carried into the pool's acquire */
export const checkoutOwner = new AsyncLocalStorage<CheckoutOwner>()

const pidOf = (client: PoolClient): number | null =>
  // not in @types/pg, set by the driver on the backend key-data message
  (client as unknown as { processID?: number | null }).processID ?? null

export const describeCheckout = (checkout: Checkout, now: number): string => {
  const held = `held ${Math.round((now - checkout.since) / 1000)}s`
  const backend = checkout.pid === null ? 'backend unknown' : `pid ${checkout.pid}`
  const owner = checkout.owner
  if (owner === undefined)
    return `${backend} ${held}, checked out by something this process did not attribute`
  const fiber = owner.fiber === undefined ? '' : ` #${owner.fiber}`
  const span = owner.span === undefined ? '' : ` (${owner.span})`
  const source = owner.source === undefined ? '' : ` for ${owner.source}`
  return `${backend} ${held} by ${owner.kind}${fiber}${span}${source}`
}

export class PoolLedger {
  readonly #held = new Map<PoolClient, Checkout>()

  /** observes one pool for the rest of its life */
  attach(pool: Pool): void {
    const connect = pool.connect.bind(pool)
    const record = (client: PoolClient, owner: CheckoutOwner | undefined) =>
      this.#held.set(client, { owner, since: Date.now(), pid: pidOf(client) })
    // both shapes the driver's callers use, so nothing bypasses the ledger
    const tagged = (
      callback?: (
        error: Error | undefined,
        client: PoolClient | undefined,
        release: (release?: unknown) => void,
      ) => void,
    ) => {
      const owner = checkoutOwner.getStore()
      if (callback !== undefined) {
        return connect((error, client, release) => {
          if (client !== undefined) record(client, owner)
          callback(error, client, release)
        })
      }
      return connect().then((client) => {
        record(client, owner)
        return client
      })
    }
    pool.connect = tagged as unknown as Pool['connect']
    pool.on('release', (_error, client) => void this.#held.delete(client))
    pool.on('remove', (client) => void this.#held.delete(client))
  }

  /** every connection out of the pool right now, oldest first */
  outstanding(): readonly Checkout[] {
    return [...this.#held.values()].sort((a, b) => a.since - b.since)
  }

  /**
   * Hands the pool back the client a token holds, as broken.
   *
   * For the release path that could not COMMIT or ROLLBACK: the driver
   * returns a transaction's client only after one of those succeeded, so a
   * refused commit on a dead session would keep the slot for the life of
   * the process. False when the token holds nothing - the usual case, where
   * a rollback already returned it.
   */
  release(token: object, error: Error): boolean {
    for (const [client, checkout] of this.#held) {
      if (checkout.owner?.token !== token) continue
      this.#held.delete(client)
      client.release(error)
      return true
    }
    return false
  }
}

export interface Backend {
  readonly pid: number
  readonly state: string | null
  readonly waitEventType: string | null
  readonly waitEvent: string | null
  readonly xactAgeSeconds: number | null
  readonly stateAgeSeconds: number | null
  readonly blockedBy: readonly number[]
  readonly query: string | null
}

/** the server could not be asked, or did not answer in time */
export class BackendsUnreadable extends Error {
  readonly _tag = 'BackendsUnreadable'
  constructor(cause: unknown) {
    super(
      `could not read pg_stat_activity: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        cause,
      },
    )
  }
}

/**
 * What the server says about every session on this database.
 *
 * On a session of its own rather than the pool, which is closing and would
 * refuse one. Bounded on both legs, because a diagnosis that can hang is
 * exactly what it exists to diagnose.
 */
export const describeBackends = (
  url: string,
): Effect.Effect<readonly Backend[], BackendsUnreadable> =>
  Effect.tryPromise({
    try: async () => {
      const client = new Client({
        connectionString: url,
        connectionTimeoutMillis: 3_000,
        query_timeout: 3_000,
      })
      await client.connect()
      try {
        const { rows } = await client.query<{
          pid: number
          state: string | null
          wait_event_type: string | null
          wait_event: string | null
          xact_age: number | null
          state_age: number | null
          blocked_by: number[]
          query: string | null
        }>(
          `select pid, state, wait_event_type, wait_event,
                  extract(epoch from (now() - xact_start))::int as xact_age,
                  extract(epoch from (now() - state_change))::int as state_age,
                  pg_blocking_pids(pid) as blocked_by,
                  left(query, 200) as query
             from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid()
            order by pid`,
        )
        return rows.map((row) => ({
          pid: row.pid,
          state: row.state,
          waitEventType: row.wait_event_type,
          waitEvent: row.wait_event,
          xactAgeSeconds: row.xact_age,
          stateAgeSeconds: row.state_age,
          blockedBy: row.blocked_by,
          query: row.query,
        }))
      } finally {
        await client.end().catch(() => undefined)
      }
    },
    catch: (cause) => new BackendsUnreadable(cause),
  })

export const describeBackend = (backend: Backend, ours: boolean): string => {
  const waiting =
    backend.waitEventType === null
      ? ''
      : ` waiting on ${backend.waitEventType}/${backend.waitEvent}`
  const xact =
    backend.xactAgeSeconds === null
      ? 'no transaction'
      : `in transaction for ${backend.xactAgeSeconds}s`
  const blocked = backend.blockedBy.length === 0 ? '' : ` blocked by ${backend.blockedBy.join(',')}`
  const query =
    backend.query === null || backend.query === '' ? '' : `; last query: ${backend.query}`
  return `pid ${backend.pid}${ours ? ' (ours)' : ''}: ${backend.state ?? 'unknown'}${waiting}, ${xact}, ${backend.stateAgeSeconds ?? '?'}s since state change${blocked}${query}`
}
