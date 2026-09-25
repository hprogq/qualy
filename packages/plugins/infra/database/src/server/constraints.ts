import { Effect } from 'effect'
import { TRANSLATABLE } from '../pg-errors.ts'

// Turning a constraint violation back into a domain error, on the Effect side.
//
// The cordis service wraps every mutation in a translator, so a restrict
// foreign key or a unique index answers with the domain error the contract
// declares rather than an opaque 500. The Effect port lost that: every
// database failure became a defect, and a delete blocked by users still
// standing on a node answered 500 where it used to answer 409.
//
// The chain is walked rather than guessed, and it is a tree rather than a
// list: a wrapper's cause can be an Effect Cause holding an array of failures
// instead of a single link, and the driver's own DatabaseError - the only
// thing carrying the sqlstate and the constraint name - sits under all of it.
// Reading only the top level finds nothing.

/** the first constraint name in the chain that belongs to a translatable sqlstate */
export const constraintOf = (error: unknown): string | undefined => {
  const seen = new Set<unknown>()
  const walk = (node: unknown, depth: number): string | undefined => {
    if (!node || typeof node !== 'object' || depth > 10 || seen.has(node)) return undefined
    seen.add(node)
    const value = node as Record<string, unknown>
    if (
      typeof value.code === 'string' &&
      TRANSLATABLE.has(value.code) &&
      typeof value.constraint === 'string'
    ) {
      return value.constraint
    }
    for (const key of ['cause', 'error', 'reason']) {
      const found = walk(value[key], depth + 1)
      if (found) return found
    }
    for (const key of ['reasons', 'failures']) {
      const list = value[key]
      if (!Array.isArray(list)) continue
      for (const entry of list) {
        const found = walk(entry, depth + 1)
        if (found) return found
      }
    }
    return undefined
  }
  return walk(error, 0)
}

/** whether any failure in the chain satisfies the test */
const anywhereInChain = (
  error: unknown,
  test: (value: Record<string, unknown>) => boolean,
): boolean => {
  const seen = new Set<unknown>()
  const walk = (node: unknown, depth: number): boolean => {
    if (!node || typeof node !== 'object' || depth > 10 || seen.has(node)) return false
    seen.add(node)
    const value = node as Record<string, unknown>
    if (test(value)) return true
    // 'defect' as well as the failure keys: a cause that reached here as a
    // die carries the driver error under it, and that is exactly the case
    // this exists for
    for (const key of ['cause', 'error', 'reason', 'defect']) {
      if (walk(value[key], depth + 1)) return true
    }
    // 'errors' is an AggregateError: node's connect() throws one per address
    for (const key of ['reasons', 'failures', 'errors']) {
      const list = value[key]
      if (!Array.isArray(list)) continue
      for (const entry of list) {
        if (walk(entry, depth + 1)) return true
      }
    }
    return false
  }
  return walk(error, 0)
}

/** whether a failure anywhere in the chain carries this sqlstate */
export const failedWith = (error: unknown, sqlstate: string): boolean =>
  anywhereInChain(error, (value) => value.code === sqlstate)

/**
 * Sqlstates that say the database could not serve the statement right now,
 * rather than that the statement was wrong.
 */
const UNAVAILABLE_SQLSTATES = new Set([
  // canceled at statement_timeout
  '57014',
  // lock_not_available: a lock wait past lock_timeout
  '55P03',
  // the server ended a transaction left idle past its timeout
  '25P03',
  // admin_shutdown, crash_shutdown, cannot_connect_now, idle_session_timeout
  '57P01',
  '57P02',
  '57P03',
  '57P05',
  // too_many_connections
  '53300',
  // connection_exception and its kinds
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
])

/** what the socket said when there was no server to say anything */
const UNAVAILABLE_SYSCALLS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
])

/**
 * What the pool and the driver raise, with no code, when a connection could
 * not be had or went away (pg-pool 3.14 index.js, pg 8.23 lib/client.js):
 * no connection within the pool's connection timeout, a new one that did not
 * open in time, a session that ended under the statement.
 */
const unavailableMessage = (message: string): boolean =>
  message === 'timeout exceeded when trying to connect' ||
  message === 'timeout expired' ||
  message.startsWith('Connection terminated') ||
  message === 'Client has encountered a connection error and is not queryable'

/**
 * Whether a failure says the database is unavailable or saturated - no
 * connection in time, a statement or lock wait past its timeout, a session
 * that dropped - rather than that the query or the data was wrong.
 *
 * A request that fails this way is answered 503 at the http boundary; a
 * constraint violation or any other refusal stays what it was.
 */
export const databaseUnavailable = (error: unknown): boolean =>
  anywhereInChain(
    error,
    (value) =>
      (typeof value.code === 'string' &&
        (UNAVAILABLE_SQLSTATES.has(value.code) || UNAVAILABLE_SYSCALLS.has(value.code))) ||
      (value instanceof Error && unavailableMessage(value.message)),
  )

/**
 * Replaces a named constraint violation with the domain error it means.
 *
 * Anything the map does not name stays exactly what it was, so the database
 * remains an honest backstop rather than a source of errors nobody declared.
 */
export const translateConstraints =
  <Domain>(map: Record<string, () => Domain>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | Domain, R> =>
    Effect.catch(effect, (error): Effect.Effect<never, E | Domain> => {
      const constraint = constraintOf(error)
      const translate = constraint ? map[constraint] : undefined
      return Effect.fail(translate ? translate() : error)
    })
