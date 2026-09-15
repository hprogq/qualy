// Which endpoint a request was, decided by the contract rather than guessed
// from the address.
//
// The address of an api call carries the row: `/api/iam/users/<uuid>/grants`
// names a person. A report must say which endpoint was slow, never which
// person it was slow for - and the only thing that knows where the row sits
// in a path is the contract that declared the path. Everything else is
// guesswork: a parameter may be a uuid, a number, a slug (`school-cas`), or a
// word the product will invent next year, and no rule about shape tells those
// from a route name. This product tried; it masked thirteen of its own route
// names and would have masked every enum parameter it has.
//
// So the templates come from the api declarations themselves, handed in as
// plain data. Nothing here knows what Effect is: the caller that holds the
// runtime contract does the extraction, and this side keeps strings.
//
// Unmatched is not sanitized, it is refused. An address under the api prefix
// that no template claims is either a route nobody registered or something
// else entirely, and in both cases this side cannot tell a name from a value.
// One telemetry record is cheaper than one identifier.

/** one endpoint, as its contract declares it */
export interface ApiRoute {
  /** upper case, as a request reports it */
  readonly method: string
  /**
   * the full path with its parameters still named, prefix included:
   * `/api/iam/users/:userId`
   */
  readonly template: string
}

/** a template split once, so matching a request is a walk rather than a parse */
interface Compiled {
  readonly template: string
  readonly segments: readonly string[]
}

/** method -> routes of that method, longest-first so a specific route wins */
const byMethod = new Map<string, Compiled[]>()
/** every template regardless of method, for the places a method is not known */
const anyMethod: Compiled[] = []

const segmentsOf = (template: string): readonly string[] =>
  template.split('/').filter((segment) => segment !== '')

const isParameter = (segment: string): boolean => segment.startsWith(':')

/**
 * Whether a compiled template claims these segments.
 *
 * A literal must match itself exactly; a parameter takes one segment and asks
 * nothing of it. Length first, because a template of a different length can
 * never match and this runs per request.
 */
const claims = (route: Compiled, segments: readonly string[]): boolean => {
  if (route.segments.length !== segments.length) return false
  for (let at = 0; at < segments.length; at += 1) {
    const declared = route.segments[at]!
    if (isParameter(declared)) continue
    if (declared !== segments[at]) return false
  }
  return true
}

/**
 * The most specific claimant, and nothing when two are equally specific.
 *
 * Specificity is how many segments are literal: `/a/b/fixed` beats
 * `/a/b/:id` for the same address, which is the reading every router gives
 * and the one a person expects. A tie between two DIFFERENT templates is an
 * ambiguity this cannot resolve, and resolving it by declaration order would
 * make the answer depend on which plugin loaded first - so it answers with
 * nothing, and the record is refused. Two routes that tie on the same
 * template are not a tie at all: they say the same thing.
 */
const bestOf = (
  candidates: readonly Compiled[],
  segments: readonly string[],
): string | undefined => {
  let best: Compiled | undefined
  let bestLiterals = -1
  let tied = false
  for (const candidate of candidates) {
    if (!claims(candidate, segments)) continue
    const literals = candidate.segments.filter((segment) => !isParameter(segment)).length
    if (literals > bestLiterals) {
      best = candidate
      bestLiterals = literals
      tied = false
    } else if (
      literals === bestLiterals &&
      best !== undefined &&
      candidate.template !== best.template
    ) {
      tied = true
    }
  }
  return tied ? undefined : best?.template
}

/**
 * Takes the routes an api declares.
 *
 * Called as clients are built, so the templates are known before the requests
 * they describe. Registering the same route twice is ordinary - two clients
 * may share a contract - and costs nothing.
 */
export const registerApiRoutes = (routes: Iterable<ApiRoute>): void => {
  for (const route of routes) {
    const method = route.method.toUpperCase()
    const compiled: Compiled = { template: route.template, segments: segmentsOf(route.template) }
    const known = byMethod.get(method)
    const already = (known ?? []).some((one) => one.template === route.template)
    if (already) continue
    if (known === undefined) byMethod.set(method, [compiled])
    else known.push(compiled)
    if (!anyMethod.some((one) => one.template === compiled.template)) anyMethod.push(compiled)
  }
}

/**
 * The template for one request, or nothing.
 *
 * `method` is optional because one caller does not have it: the vendor's
 * error logs carry the address inside a sentence and no method beside it.
 * Matching on the path alone is well defined here - the endpoints that share
 * a path share its shape, which is what makes `GET` and `DELETE` of one row
 * the same template - and a path that would answer differently per method is
 * exactly the tie that answers with nothing.
 */
export const apiRouteFor = (pathname: string, method?: string): string | undefined => {
  const segments = segmentsOf(pathname)
  if (segments.length === 0) return undefined
  const candidates = method === undefined ? anyMethod : (byMethod.get(method.toUpperCase()) ?? [])
  return bestOf(candidates, segments)
}

/** for tests and for a page that is starting over */
export const resetApiRoutes = (): void => {
  byMethod.clear()
  anyMethod.length = 0
}

/** how many distinct templates are known; a caller that expected some can say so */
export const apiRouteCount = (): number => anyMethod.length
