import { Cause, Exit, Option } from 'effect'

// What the sign-in page's server render makes of its two reads
// (LoginPage.server.tsx): an answer is passed on as one; a server that could
// not be asked leaves the page undecided, to ask for itself in the browser;
// a reader who left ends the render; anything else is a bug and is thrown.

/** the reader went away while the page was asking: the render ends with them */
const cancelled = (cause: Cause.Cause<unknown>) => Cause.hasInterruptsOnly(cause)

/**
 * The read did not get an answer this render can use, and the page asks
 * again in the browser: the network failed, or a status the contract does
 * not name came back - a server restarting, or a proxy in front of one.
 * Anything else - an answer that does not decode, a defect - is a bug, and
 * is not hidden behind the page asking again.
 */
const unanswered = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const { _tag, reason } = error as { _tag?: unknown; reason?: { _tag?: unknown } }
  return (
    _tag === 'HttpClientError' &&
    (reason?._tag === 'TransportError' || reason?._tag === 'StatusCodeError')
  )
}

const failureOf = <E>(cause: Cause.Cause<E>): Option.Option<E> =>
  Cause.hasDies(cause) ? Option.none() : Cause.findErrorOption(cause)

/** whether somebody is signed in, or undecided when the server could not say */
export const presenceOf = (exit: Exit.Exit<unknown, unknown>): boolean | undefined => {
  if (Exit.isSuccess(exit)) return true
  if (cancelled(exit.cause)) throw Cause.squash(exit.cause)
  const failure = failureOf(exit.cause)
  if (Option.isSome(failure)) {
    const tag = (failure.value as { _tag?: unknown })._tag
    // the session middleware's own answers: nobody, or a session that lapsed
    if (tag === 'AUTH_REQUIRED' || tag === 'SESSION_EXPIRED') return false
    if (unanswered(failure.value)) return undefined
  }
  throw Cause.squash(exit.cause)
}

/** the workspace's ways in, or nothing for the page to ask for itself */
export const methodsOf = <A>(exit: Exit.Exit<A, unknown>): A | undefined => {
  if (Exit.isSuccess(exit)) return exit.value
  if (cancelled(exit.cause)) throw Cause.squash(exit.cause)
  const failure = failureOf(exit.cause)
  if (Option.isSome(failure) && unanswered(failure.value)) return undefined
  throw Cause.squash(exit.cause)
}
