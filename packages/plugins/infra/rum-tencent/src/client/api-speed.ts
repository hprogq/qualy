import { QUALY_API_PREFIX, QUALY_REQUEST_ID_HEADER } from '@qualy/api-kit'
import { apiRouteFor } from '@qualy/browser-observability/api-routes'

// What this deployment is willing to learn about its own api calls, and what
// it refuses to learn about anything else.
//
// Turning the vendor's api timing on produces two records per request, down
// two different pipelines, and they are not the same shape. The timing record
// is structured - url, method, status, duration - and this file keeps the
// ones that are this product's own api. The other is an error log, and it is
// raised for every 4xx, which in this product is mostly not an error at all:
// a refusal, an expired session, a row that is not there. Those are answers
// the contract defines, and left alone they would fill an error panel with
// things that are working.
//
// The status is the whole difficulty. It reaches the error log ONLY inside a
// prose message ("res status: 404"), and reading a status back out of that
// string is exactly what the design forbade - the message is the vendor's to
// change. The way out is a hook the vendor offers for a different purpose:
// `retCodeHandler` is asked what a response "returned", and whatever it
// answers is carried on BOTH records as a structured field. So this file
// answers with the http status, and everything downstream reads a number that
// this product put there rather than a sentence it has to parse.
//
// The address is the other half, and it is answered by the contract rather
// than by this file: `apiRouteFor` is told every route the api declares as
// clients are built, and returns the template or nothing.

/** the path prefix every api call of this product's own shares */
const API_ROOT = `${QUALY_API_PREFIX}/`

/** what the vendor puts on a log it raised for a transport failure, not a response */
const TRANSPORT_FAILURE = -400

/**
 * What stands in a message for an api address no contract claims.
 *
 * Not a masked version of the address: masking is what this product stopped
 * doing, because deciding which segment of `/api/auth/local/school-cas/login`
 * is a value needs the declaration and nothing else can stand in for it. So
 * an unclaimed address says only that it was one, which is also the signal
 * worth acting on - a route reaching here means something makes api calls
 * through a client nobody registered.
 */
export const UNCLAIMED_API_ROUTE = `${QUALY_API_PREFIX}/<unclaimed>`

/**
 * The status a response carried, as this product recorded it.
 *
 * The vendor's own default reads a return code out of the body, which this
 * product's bodies do not carry - every one of them would answer "unknown".
 * The body is never read here: a request's body and its answer are a
 * student's material and a reviewer's decision.
 */
export const retCodeHandler = (
  _body: unknown,
  _url: unknown,
  context: unknown,
): { readonly code: string; readonly isErr: boolean } => {
  const status = statusOf(context)
  return {
    code: String(status),
    // What counts as the api failing. A 4xx is this product answering, and
    // counting refusals as failures would make the success rate say nothing;
    // the status rides the record either way, so anyone who wants them can
    // still ask for them.
    isErr: status <= 0 || status >= 500,
  }
}

const statusOf = (context: unknown): number => {
  if (typeof context !== 'object' || context === null) return 0
  const status = (context as { status?: unknown }).status
  return typeof status === 'number' ? status : 0
}

/** the path, when the address is this origin's; otherwise nothing */
const samePathOf = (url: string): string | undefined => {
  const withoutQuery = (path: string): string => path.replace(/[?#].*$/, '')
  if (url.startsWith('/')) return withoutQuery(url)
  try {
    const parsed = new URL(url, location.href)
    return parsed.origin === location.origin ? parsed.pathname : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether an address is this deployment's own api, whatever route it names.
 *
 * Same-origin first, and the origin is only there to ask while the address
 * still carries one - a third party's `/api/...` is somebody else's product.
 */
export const isApiAddress = (url: string): boolean => {
  const path = samePathOf(url)
  return path !== undefined && path.startsWith(API_ROOT)
}

/**
 * Which endpoint an address is, according to the contract that declared it.
 *
 * Nothing means one of three things and they deliberately share an answer:
 * another origin's, not under the api prefix, or an api address no registered
 * route claims. All three are addresses this file cannot describe without
 * repeating them, and repeating them is the thing being avoided.
 *
 * The method is optional because one caller has it and the other does not:
 * the timing record carries `method` as a field, while an error log carries
 * the address inside a sentence with nothing beside it.
 */
export const observedApiRoute = (url: unknown, method?: unknown): string | undefined => {
  if (typeof url !== 'string') return undefined
  const path = samePathOf(url)
  if (path === undefined || !path.startsWith(API_ROOT)) return undefined
  return apiRouteFor(path, typeof method === 'string' ? method : undefined)
}

/**
 * The address a timing record is filed under, on its way in.
 *
 * Runs before every other hook, and its one job is the origin: the vendor
 * applies it only to records it classified as a request rather than an asset,
 * so it is not a chokepoint and must not be treated as one. What it does do
 * is decide same-origin while the origin is still there to decide with, and
 * answer with a path that carries nothing when it was not this deployment's.
 * The route itself is decided in `beforeReportSpeed`, which is the hook every
 * record passes through and the one that knows the method.
 */
export const apiSpeedUrl = (url: string): string => samePathOf(url) ?? '/'

/** the header the browser is allowed to read back, so a report names its request */
export const OBSERVED_RESPONSE_HEADERS: readonly string[] = [QUALY_REQUEST_ID_HEADER]

/**
 * Runs on every timing record on its way out, and decides both questions.
 *
 * Fail closed, by design: a record whose address no contract claims is not
 * sanitized and sent, it is dropped. The alternative was guessing which of
 * its segments were values, which this product tried and got wrong in both
 * directions - it masked thirteen of its own route names, and it would have
 * passed on `school-cas`, `review-entry` and `1` as if they were names. One
 * missing timing record costs a line on a chart. One leaked segment cannot be
 * taken back.
 */
export const beforeReportSpeed = (log: {
  url?: unknown
  method?: unknown
  [key: string]: unknown
}): boolean => {
  try {
    const route = observedApiRoute(log.url, log.method)
    if (route === undefined) return false
    log.url = route
  } catch {
    // a record this file could not judge is one it does not send
    return false
  }
  return true
}

/**
 * Whether an error log the vendor raised for an api call is worth keeping.
 *
 * Reads the status this file put on the record, never the message. A 4xx is
 * this product answering and is dropped - except 429, which is the one 4xx
 * nobody authored: it says a client is being turned away by rate, which is an
 * operational fact and not a domain outcome. A transport failure is kept,
 * because a request that never arrived is not an answer at all. Anything this
 * file cannot read is kept: an unrecognised record is a reason to look, not a
 * reason to look away.
 */
export const keepsApiErrorLog = (code: unknown): boolean => {
  const status = typeof code === 'number' ? code : Number(code)
  if (!Number.isFinite(status)) return true
  if (status === TRANSPORT_FAILURE) return true
  if (status === 429) return true
  return !(status >= 400 && status <= 499)
}
