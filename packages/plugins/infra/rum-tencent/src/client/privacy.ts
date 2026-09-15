import { observedPageUrl, sanitizeUrl } from '@qualy/browser-observability'
import {
  isApiAddress,
  keepsApiErrorLog,
  observedApiRoute,
  UNCLAIMED_API_ROUTE,
} from './api-speed.ts'

// What this vendor sends that it should not, removed before it goes.
//
// Not guesswork: the sdk was run against a local stand-in for the reporting
// host with a sentinel in the address and in the referrer, and every request
// it made was read off the wire. Out of the box a navigation carrying one
// sentinel put it on the wire seventeen times. The findings and the method are
// in docs/notes/aegis-web-sdk.md; the three leaks are below, and each needs a
// different lever because the sdk attaches them at three different moments.
//
// The load-bearing one is `beforeReport`. A hook that only rewrites the
// request url leaves the same address sitting inside the body, which was
// measured: seven sentinels survived that way.

/** what the sdk hands the log hook; its own types say `Function`, so this is ours */
interface ReportedLog {
  msg?: unknown
  level?: string
  originFrom?: unknown
  [key: string]: unknown
}

/** LogType.IMAGE_ERROR, from the sdk's own enum */
const IMAGE_ERROR = '64'

/** LogType.AJAX_ERROR: an api call the sdk decided was a failure */
const AJAX_ERROR = '16'

/**
 * Every level whose message the sdk assembles out of an api call.
 *
 * The three differ by how the call went wrong, not by what they say: each
 * carries the same `fetch req url:` line with the whole path in it. Which one
 * a call becomes depends on how it was made - through fetch a 5xx is an ajax
 * error, through XHR the same 5xx is a retcode error, because only the fetch
 * path looks at the http status. So the masking is keyed on "this is about an
 * api call" rather than on the one level this product happens to produce.
 */
const API_LEVELS = new Set([
  AJAX_ERROR,
  '1024', // RET_ERROR
  '1027', // SLOW_NET_REQUEST
])

/**
 * A url inside a message, with its query removed.
 *
 * Narrow on purpose: anchored to a url so that a message which merely ends in
 * a question mark keeps its words. Resource failures arrive as
 * `script load fail: <url>`, and this product's assets are hashed names with
 * nothing after them - but a url that did carry a query would carry it here.
 */
const withoutQueryStrings = (text: string): string =>
  text.replaceAll(/(https?:\/\/[^\s)'"]+?)\?[^\s)'"]*/g, '$1')

/**
 * One address, reduced to whatever may be said about it.
 *
 * Two kinds reach here and they are answered by two different authorities. An
 * api address is answered by the contract that declared the route, because
 * only the declaration knows which segment is the row - and when no contract
 * claims it, nothing is said about it at all. Everything else is a page or an
 * asset, where the page sanitizer's guess is the right tool and always was:
 * it is reading addresses this product's own router shaped.
 */
const asAddressMayRead = (address: string): string =>
  isApiAddress(address) ? (observedApiRoute(address) ?? UNCLAIMED_API_ROUTE) : sanitizeUrl(address)

/**
 * The addresses inside an api error message, reduced.
 *
 * That message is assembled by the vendor out of lines, and two of them are
 * addresses: the request's own, and whatever the page was. Stripping the
 * query is not enough for an api call the way it is for an asset - this
 * product's api paths carry the row in them, `/api/.../batches/<id>/entries`,
 * and a message is the one place a whole path survives.
 *
 * No method is available: the address sits inside a sentence with nothing
 * beside it, which is why the route lookup accepts a path alone.
 */
const withoutAddresses = (text: string): string =>
  text.replaceAll(/(?:https?:\/\/[^\s)'"]*)?\/[^\s)'"]*/g, (match) => asAddressMayRead(match))

/**
 * Runs on every log, before it is queued.
 *
 * `originFrom` is the sdk's own copy of `location.href`, attached to each log
 * and reachable by nothing else: the global url handler governs `from` and not
 * this. Replacing it in place works because the hook receives the log itself,
 * which is also why this function must not throw - the sdk wraps the whole
 * batch in one try, so a throw here drops every log in it silently.
 */
export const beforeReport = (log: ReportedLog): boolean => {
  try {
    // an image that failed to load says more about a url than about the page,
    // and this product's pages do not depend on one
    if (log.level === IMAGE_ERROR) return false
    // an api call this product answered on purpose is not a failure; the
    // decision reads the status off the record rather than out of the prose
    if (log.level === AJAX_ERROR && !keepsApiErrorLog(log.code)) return false
    if ('originFrom' in log) log.originFrom = observedPageUrl()
    if (typeof log.msg === 'string') {
      log.msg =
        typeof log.level === 'string' && API_LEVELS.has(log.level)
          ? withoutAddresses(log.msg)
          : withoutQueryStrings(log.msg)
    }
  } catch {
    // a scrub that failed is not a reason to lose the batch; the report goes
    // as it is, and the wire-level checks in the browser suite are what would
    // catch this having happened
  }
  return true
}

/**
 * Runs once per log on its way out, and is the only place a whole report can
 * be dropped by type.
 *
 * The page view is dropped because its address is built from
 * `location.href` directly, before any log-level hook exists, and there is no
 * setting that turns it off. Nothing is lost: this is reporting, not product
 * analytics, and a page view is exactly the record this deployment said it
 * would not keep.
 */
export const beforeRequest = (entry: {
  readonly logs: unknown
  readonly logType: string
}): false | { readonly logs: unknown; readonly logType: string } =>
  entry.logType === 'pv' ? false : entry
