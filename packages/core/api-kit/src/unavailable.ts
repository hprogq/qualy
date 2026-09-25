import { Cause, Effect } from 'effect'
import { HttpRouter, HttpServerRespondable, HttpServerResponse } from 'effect/unstable/http'
import { ServiceUnavailable } from './schema.ts'

// A request that failed because something this server depends on is down or
// saturated, answered as that rather than as a fault of the code.
//
// Which failures mean that is the dependency's own knowledge: a database pool
// that could not hand out a connection in time, a statement or a lock wait the
// server cancelled at its timeout, a session that dropped. The kit knows none
// of it. A failure says so by carrying the mark below, set by whoever raised
// it - the database plugin marks its own query failures - and the router
// middleware here answers every request whose defect carries one, however
// deep in its chain of causes, with the kit's 503.
//
// Only defects are read. A declared failure is an answer the endpoint chose -
// a constraint violation it translated stays the 409 it was - and a defect
// nobody marked stays the 500 it always was.
//
// Its own subpath, like ./storable-text: nothing here belongs in a browser
// bundle.

/**
 * The property a failure sets, to the name of the dependency, when what it
 * says is that the dependency is unavailable.
 *
 * A registered symbol rather than a class to extend: the failure keeps the
 * type its callers already match on (`QueryFailed` stays a `QueryFailed`),
 * and two copies of this module still agree on the key.
 */
export const unavailable: unique symbol = Symbol.for('@qualy/api-kit/unavailable')

/** how far down a chain of causes a mark is looked for */
const MAX_DEPTH = 10

/**
 * The defect in this cause that says a dependency is unavailable, with the
 * dependency it names, if there is one.
 *
 * A chain rather than only the defect itself: a service that re-raised the
 * failure inside an error of its own kept it as that error's `cause`.
 */
const markedDefect = (
  cause: Cause.Cause<unknown>,
): { readonly dependency: string; readonly defect: unknown } | undefined => {
  for (const reason of cause.reasons) {
    if (reason._tag !== 'Die') continue
    const seen = new Set<unknown>()
    let node: unknown = reason.defect
    for (let depth = 0; depth <= MAX_DEPTH; depth++) {
      if (typeof node !== 'object' || node === null || seen.has(node)) break
      seen.add(node)
      const mark = (node as { readonly [unavailable]?: unknown })[unavailable]
      if (typeof mark === 'string') return { dependency: mark, defect: reason.defect }
      node = (node as { readonly cause?: unknown }).cause
    }
  }
  return undefined
}

/** the dependency a defect in this cause says is unavailable, if one does */
export const unavailableIn = (cause: Cause.Cause<unknown>): string | undefined =>
  markedDefect(cause)?.dependency

const answer = HttpServerResponse.schemaJson(ServiceUnavailable)(
  new ServiceUnavailable({ message: 'The service is temporarily unavailable. Try again shortly.' }),
  { status: 503 },
).pipe(Effect.orDie)

/**
 * What the request died of, restated as a defect that answers for itself.
 *
 * A defect rather than a response the middleware returns: the platform then
 * sends this answer and still hands the failure up the serve chain, so the
 * access log writes the 503 with its cause at Error, the way it writes every
 * other server fault - the cause is where the operator learns which
 * dependency, and why.
 */
class DependencyUnavailable extends Error {
  readonly dependency: string
  constructor(dependency: string, cause: unknown) {
    super(`the request failed because ${dependency} is unavailable`, { cause })
    this.name = 'DependencyUnavailable'
    this.dependency = dependency
  }

  [HttpServerRespondable.symbol]() {
    return answer
  }
}

/**
 * Mounted once, beside the routes, so every endpoint answers alike.
 *
 * A router middleware for the reason `schemaRefusals` is one: a serve
 * middleware runs around the sending of the response, and a change it makes
 * is not what the client receives.
 */
export const unavailableDependencies = HttpRouter.middleware(
  (app) =>
    Effect.catchCause(app, (cause) => {
      const marked = markedDefect(cause)
      return marked === undefined
        ? Effect.failCause(cause)
        : Effect.die(new DependencyUnavailable(marked.dependency, marked.defect))
    }),
  { global: true },
)
