import { ByteSize, Clock, Effect } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { REPORT_PATH } from './shell-policy.ts'

// Where a browser tells us the policy blocked something.
//
// A noise channel by nature: it is unauthenticated (a report arrives from
// a page that may not have a session yet), it is written by the browser
// in whichever of two formats it prefers, and a single broken source on a
// busy page could post the same report thousands of times a minute. So it
// never answers 500, never stores a body, and never logs more than the
// six fields that say what was blocked where - `script-sample` in
// particular is left out, since it can quote page content.
//
// Reports are logged once per minute per (directive, blocked url, source
// file): the first report of a key is logged as it arrives, repeats within
// the minute are counted, and the next report after the minute is logged
// with that count. Nothing here is scheduled; the count rides the next
// line rather than a timer.
//
// The key is written by whoever posts, so deduplication alone bounds
// nothing: a script sending a fresh blocked url every time got one Warn
// line per report, 32 per request, and could rotate a deployment's whole
// retained log away in minutes. So the endpoint also has a budget of lines
// per window, whoever is sending. Past it a new key is counted and not
// remembered - remembering it would let a flood push real keys out of the
// table - and the next line written says how many went unlogged.

/** the most a report body may be; a browser's report is a few hundred bytes */
export const MAX_REPORT_BYTES = 64 * 1024

/** the deduplication window */
export const REPORT_WINDOW_MS = 60_000

/** longer than this, a field is a payload rather than a location */
const FIELD_LIMIT = 512

const LEGACY = 'application/csp-report'
const REPORTING = 'application/reports+json'

export interface CspReport {
  readonly documentUri: string | undefined
  readonly effectiveDirective: string | undefined
  readonly blockedUri: string | undefined
  readonly sourceFile: string | undefined
  readonly lineNumber: number | undefined
  readonly disposition: string | undefined
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.slice(0, FIELD_LIMIT) : undefined

const integer = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

/** the `report-uri` body: `{"csp-report": {...}}` with hyphenated keys */
const legacyReport = (body: Record<string, unknown>): CspReport | undefined => {
  const report = record(body['csp-report'])
  if (report === undefined) return undefined
  return {
    documentUri: text(report['document-uri']),
    effectiveDirective: text(report['effective-directive'] ?? report['violated-directive']),
    blockedUri: text(report['blocked-uri']),
    sourceFile: text(report['source-file']),
    lineNumber: integer(report['line-number']),
    disposition: text(report['disposition']),
  }
}

/**
 * How many reports one body is read for.
 *
 * A browser batches a handful. The 64 KiB body ceiling already bounds this
 * loosely, but a tiny report is small enough that the bound it implies is in
 * the hundreds, and every one of them costs a key in the table below.
 */
const MAX_REPORTS_PER_BODY = 32

/** the Reporting API body: a list of `{type, body}`, camel-cased, other types mixed in */
const reportingApiReports = (list: unknown): readonly CspReport[] => {
  if (!Array.isArray(list)) return []
  const reports: CspReport[] = []
  for (const item of list) {
    if (reports.length >= MAX_REPORTS_PER_BODY) break
    const entry = record(item)
    if (entry === undefined || entry['type'] !== 'csp-violation') continue
    const body = record(entry['body'])
    if (body === undefined) continue
    reports.push({
      documentUri: text(body['documentURL']),
      effectiveDirective: text(body['effectiveDirective']),
      blockedUri: text(body['blockedURL']),
      sourceFile: text(body['sourceFile']),
      lineNumber: integer(body['lineNumber']),
      disposition: text(body['disposition']),
    })
  }
  return reports
}

/**
 * The reports in a body, by content type; `undefined` when the body is not
 * the format its type claims. An empty list is a well-formed body with
 * nothing in it, which is also not an error.
 */
export const parseReports = (
  contentType: string,
  body: string,
): readonly CspReport[] | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (contentType === LEGACY) {
    const object = record(parsed)
    if (object === undefined) return undefined
    const report = legacyReport(object)
    return report === undefined ? undefined : [report]
  }
  return Array.isArray(parsed) ? reportingApiReports(parsed) : undefined
}

/**
 * The three fields that make one violation the same violation, joined on a
 * character none of them can contain.
 *
 * Written as an escape rather than as the byte itself: a literal NUL in a
 * source file makes ripgrep and grep call the whole file binary and skip it,
 * so this module was invisible to every repo-wide search.
 */
export const reportKey = (report: CspReport): string =>
  `${report.effectiveDirective ?? ''}\u0000${report.blockedUri ?? ''}\u0000${report.sourceFile ?? ''}`

/** how many distinct keys the table holds before the oldest is dropped */
export const MAX_TRACKED_KEYS = 4096

/**
 * How many report lines the endpoint writes per window, all senders together.
 *
 * A real policy problem is a handful of keys, each logged once a minute; this
 * is room for a bad release breaking many pages at once, and a ceiling of
 * about three thousand lines an hour for somebody posting noise on purpose.
 */
export const MAX_LOGGED_PER_WINDOW = 50

export interface ReportVerdict {
  /** whether this report is written to the log */
  readonly log: boolean
  /** repeats of the same key swallowed since it was last written */
  readonly suppressed: number
  /** reports of new keys left unlogged over the budget since the last line; carried by a logged verdict only */
  readonly dropped: number
}

/**
 * Once per key per window.
 *
 * `suppressed` on a logged report is how many repeats of the same key were
 * swallowed in the window before this one.
 *
 * The window does not bound the table on its own. The key is three fields
 * read off an unauthenticated body, so a burst of distinct keys inside one
 * window has nothing in it old enough to expire - the table just grows, and
 * sweeping it on every insert made each new key cost a walk of every key
 * before it. So the table has a size of its own and drops the key logged
 * longest ago when it is full. An entry past its window is harmless where
 * it sits: the read above already treats it as expired.
 */
export const makeReportDeduper = (
  windowMs: number = REPORT_WINDOW_MS,
  budget: number = MAX_LOGGED_PER_WINDOW,
) => {
  const seen = new Map<string, { since: number; repeats: number }>()
  // the budget's own window: a fixed one, opened by the first line that
  // wants writing after the previous one closed
  let opened = Number.NEGATIVE_INFINITY
  let spent = 0
  let dropped = 0
  return (key: string, now: number): ReportVerdict => {
    const entry = seen.get(key)
    if (entry !== undefined && now - entry.since < windowMs) {
      entry.repeats += 1
      return { log: false, suppressed: entry.repeats, dropped: 0 }
    }
    if (now - opened >= windowMs) {
      opened = now
      spent = 0
    }
    if (spent >= budget) {
      // a known key keeps counting, so its next line still says how often
      // it came; a new one is only counted
      if (entry === undefined) dropped += 1
      else entry.repeats += 1
      return { log: false, suppressed: entry?.repeats ?? 0, dropped: 0 }
    }
    spent += 1
    const unlogged = dropped
    dropped = 0
    const suppressed = entry?.repeats ?? 0
    seen.delete(key)
    seen.set(key, { since: now, repeats: 0 })
    // insertion order is order of last logging, so the front of the map is
    // the key nobody has reported for longest
    while (seen.size > MAX_TRACKED_KEYS) {
      const oldest = seen.keys().next()
      if (oldest.done === true) break
      seen.delete(oldest.value)
    }
    return { log: true, suppressed, dropped: unlogged }
  }
}

const mediaType = (header: string | undefined): string =>
  (header ?? '').split(';')[0]!.trim().toLowerCase()

const exceeded = (failure: unknown): boolean =>
  String(
    (failure as { reason?: { cause?: unknown } })?.reason?.cause ??
      (failure as { message?: string })?.message ??
      failure,
  ).includes('maxBytes')

/**
 * Registers `POST /csp-reports` on the router.
 *
 * 415 for a body that is neither report format, 413 for one over the
 * limit (declared or actual), 204 for everything else - including a body
 * the parser could not read, which is logged at Debug and dropped rather
 * than answered with an error the browser would only retry.
 */
export const addReportRoute = (
  router: HttpRouter.HttpRouter,
  options: { readonly source: string },
): Effect.Effect<void> => {
  const deduplicate = makeReportDeduper()
  return router.add(
    'POST',
    REPORT_PATH,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const type = mediaType(request.headers['content-type'])
      if (type !== LEGACY && type !== REPORTING) return HttpServerResponse.empty({ status: 415 })
      const declared = Number(request.headers['content-length'] ?? '0')
      if (declared > MAX_REPORT_BYTES) return HttpServerResponse.empty({ status: 413 })
      const read = yield* Effect.result(
        request.text.pipe(
          Effect.provideService(HttpServerRequest.MaxBodySize, ByteSize.bytes(MAX_REPORT_BYTES)),
        ),
      )
      if (read._tag === 'Failure') {
        return HttpServerResponse.empty({ status: exceeded(read.failure) ? 413 : 204 })
      }
      const reports = parseReports(type, read.success)
      if (reports === undefined) {
        yield* Effect.logDebug('a csp report could not be read and was dropped').pipe(
          Effect.annotateLogs({ source: options.source, contentType: type }),
        )
        return HttpServerResponse.empty({ status: 204 })
      }
      const now = yield* Clock.currentTimeMillis
      for (const report of reports) {
        const verdict = deduplicate(reportKey(report), now)
        if (!verdict.log) continue
        if (verdict.dropped > 0) {
          yield* Effect.logWarning(
            'content security policy reports went unlogged over the per-minute budget',
          ).pipe(Effect.annotateLogs({ source: options.source, dropped: verdict.dropped }))
        }
        yield* Effect.logWarning('content security policy violation reported').pipe(
          Effect.annotateLogs({
            source: options.source,
            documentUri: report.documentUri ?? null,
            effectiveDirective: report.effectiveDirective ?? null,
            blockedUri: report.blockedUri ?? null,
            sourceFile: report.sourceFile ?? null,
            lineNumber: report.lineNumber ?? null,
            disposition: report.disposition ?? null,
            suppressed: verdict.suppressed,
          }),
        )
      }
      return HttpServerResponse.empty({ status: 204 })
    }),
  )
}
