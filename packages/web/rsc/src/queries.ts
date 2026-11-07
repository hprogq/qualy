import { Cause, Exit, Option } from 'effect'
import { QueryClient, dehydrate, type DehydratedState, type QueryKey } from '@tanstack/query-core'

// What a page's server entry reads on the page's behalf, and how it hands
// that over (docs/adr/0012-rsc-data-mode.md).
//
// A server entry reads what the page's first screen shows, as the viewer,
// through the same contract the page reads it with, and puts each answer in
// a query cache made for this one request - never one shared between
// requests, which would be one reader's data waiting for the next. The
// cache is then handed to the page (@qualy/web-runtime/query-hydration),
// under the keys the page reads with (@qualy/web-runtime/query-key), so the
// html carries what the page shows and the page does not ask for it again.
//
// What a read ended as decides what is handed over, and only an answer
// the page would have had for itself is:
//
// - an answer is held under its key;
// - a refusal the page shows as it is - the subject is not there, or not
//   the reader's - may be held as one, plain and tagged as the wire said
//   it, so the page draws the same state it would have drawn;
// - a session that went, or a page that is somebody else's, is not held:
//   the page asks for itself and its own reads meet the refusal, which the
//   session's recovery answers as it answers any other;
// - a server that could not be asked is not held either: the page asks;
// - a reader who left ends the render, and a defect is thrown, as a bug.

/** how a read ended, as a server entry answers it */
export type Settled<A, E> =
  | { readonly kind: 'answer'; readonly value: A }
  | { readonly kind: 'refused'; readonly error: E }
  | { readonly kind: 'unanswered' }

/**
 * The read did not get an answer this render can use, and the page asks
 * again in the browser: the network failed, or a server error came back -
 * a server restarting, or a proxy in front of one answering for it.
 *
 * Told by the status, not by the shape the client gave the failure: a
 * status the contract does not name at all arrives as a DecodeError
 * (effect/http-api HttpApiClient, `statusOrElse`), and one it names whose
 * body does not decode as a StatusCodeError. A 5xx is either way a server
 * that could not answer; anything else that does not decode - an answer of
 * the wrong shape - is a contract the two sides disagree on, and a bug.
 */
const unanswered = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const { _tag, reason } = error as {
    _tag?: unknown
    reason?: { _tag?: unknown; response?: { status?: unknown } }
  }
  if (_tag !== 'HttpClientError') return false
  if (reason?._tag === 'TransportError') return true
  const status = reason?.response?.status
  return (
    (reason?._tag === 'StatusCodeError' || reason?._tag === 'DecodeError') &&
    typeof status === 'number' &&
    status >= 500
  )
}

/** a failure the contract names: a tagged value the server sent */
const named = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const tag = (error as { _tag?: unknown })._tag
  return typeof tag === 'string' && /^[A-Z][A-Z0-9_]*$/.test(tag)
}

/**
 * How a read ended. Throws for a reader who left, which ends the render,
 * and for what is a bug - an answer that does not decode, a defect - which
 * is not hidden behind the page asking again.
 */
export const settle = <A, E>(exit: Exit.Exit<A, E>): Settled<A, E> => {
  if (Exit.isSuccess(exit)) return { kind: 'answer', value: exit.value }
  if (Cause.hasInterruptsOnly(exit.cause)) throw Cause.squash(exit.cause)
  const failure = Cause.hasDies(exit.cause) ? Option.none() : Cause.findErrorOption(exit.cause)
  if (Option.isSome(failure)) {
    if (unanswered(failure.value)) return { kind: 'unanswered' }
    if (named(failure.value)) return { kind: 'refused', error: failure.value }
  }
  throw Cause.squash(exit.cause)
}

/**
 * The refusals that are about the reader's session rather than about what
 * was read: a page given one of these as its answer would show a lost
 * session as a failed section, where the recovery would have asked the same
 * person back.
 */
const SESSION_REFUSALS: ReadonlySet<string> = new Set([
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'IDENTITY_CHANGED',
  'IDENTITY_UNASSERTED',
])

/** whether a refusal is the session's, which the page's own reads meet and recover from */
export const isSessionRefusal = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  SESSION_REFUSALS.has((error as { _tag?: unknown })._tag as string)

export interface ServerQueries {
  /** holds an answer under the key the page reads it with */
  readonly hold: (key: QueryKey, value: unknown) => void
  /**
   * Holds a refusal the page shows as it is, as the plain tagged value the
   * wire carried: what the page's failure states read is the tag.
   */
  readonly holdRefusal: (key: QueryKey, error: unknown) => void
  /** everything held, for @qualy/web-runtime/query-hydration */
  readonly dehydrated: () => DehydratedState
}

/** a query cache for one request's server entry */
export const serverQueries = (): ServerQueries => {
  const client = new QueryClient()
  return {
    hold: (key, value) => {
      client.setQueryData(key, value)
    },
    holdRefusal: (key, error) => {
      const tag = (error as { _tag?: unknown })._tag
      if (typeof tag !== 'string') throw new Error('only a tagged refusal is held')
      // the tag alone: a field of a refusal is the server's, and whatever
      // the page needs to show the state is in the tag
      // typed as the cache's error, which it reads by its tag alone
      const plain = { _tag: tag } as unknown as Error
      const at = Date.now()
      client.getQueryCache().build(client, { queryKey: key }).setState({
        status: 'error',
        error: plain,
        errorUpdatedAt: at,
        errorUpdateCount: 1,
        fetchFailureCount: 1,
        fetchFailureReason: plain,
        fetchStatus: 'idle',
      })
    },
    dehydrated: () =>
      dehydrate(client, {
        shouldDehydrateQuery: (query) =>
          query.state.status === 'success' || query.state.status === 'error',
        // the refusals held are plain tags, made to be handed over
        shouldRedactErrors: () => false,
      }),
  }
}
