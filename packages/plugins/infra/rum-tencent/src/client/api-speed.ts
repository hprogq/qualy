import { QUALY_API_PREFIX, QUALY_REQUEST_ID_HEADER } from '@qualy/api-kit'
import { sanitizeUrl } from '@qualy/browser-observability'

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

/** the path prefix every api call of this product's own shares */
const API_ROOT = `${QUALY_API_PREFIX}/`

/** what the vendor puts on a log it raised for a transport failure, not a response */
const TRANSPORT_FAILURE = -400

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

/**
 * Whether a timing record is one of this product's own api calls.
 *
 * An allowlist, not a blocklist: the reporting host itself, the object store,
 * the release probe, every hashed asset and anything a future dependency
 * calls are all outside it by default rather than by being remembered.
 */
export const isObservedApiRoute = (url: unknown): boolean =>
  typeof url === 'string' && url.startsWith(API_ROOT)

/**
 * The address a timing record is filed under.
 *
 * Runs before the record reaches any other hook, so what the rest of this
 * file sees is already a route rather than a row. Same-origin is decided
 * here, while the origin is still there to decide it with - the sanitizer
 * drops it, and afterwards nothing could tell this deployment's api from
 * somebody else's.
 */
export const apiSpeedUrl = (url: string): string => {
  const path = samePathOf(url)
  // not ours: it carries nothing, and the filter below drops it. Answering
  // with the address would put a third party's url on a record this
  // deployment is about to throw away
  return path === undefined ? '/' : sanitizeUrl(path)
}

/** the path, when the address is this origin's; otherwise nothing */
const samePathOf = (url: string): string | undefined => {
  if (url.startsWith('/')) return url
  try {
    const parsed = new URL(url, location.href)
    return parsed.origin === location.origin ? `${parsed.pathname}${parsed.search}` : undefined
  } catch {
    return undefined
  }
}

/** the header the browser is allowed to read back, so a report names its request */
export const OBSERVED_RESPONSE_HEADERS: readonly string[] = [QUALY_REQUEST_ID_HEADER]

/**
 * Runs on every timing record on its way out.
 *
 * The sanitizing repeats what `apiSpeedUrl` already did, and deliberately:
 * the vendor applies that handler only to records it classified as a request
 * rather than an asset, and the classification is by file extension. An api
 * that answers a document would arrive here with its real path. Sanitizing
 * twice costs nothing - a masked path masks to itself.
 */
export const beforeReportSpeed = (log: { url?: unknown; [key: string]: unknown }): boolean => {
  try {
    if (!isObservedApiRoute(log.url)) return false
    log.url = sanitizeUrl(log.url as string)
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
