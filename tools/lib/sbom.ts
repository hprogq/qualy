// GitHub's dependency graph as an SPDX document, through the asynchronous
// export: the synchronous `GET /repos/{repo}/dependency-graph/sbom` stops
// answering on 2026-11-13
// (https://github.blog/changelog/2026-05-12-synchronous-sbom-api-deprecated/).
//
// Measured against this repository on 2026-10-15, where the documentation
// leaves gaps:
// - `generate-report` is a GET answered 201 with `{ sbom_url }`, and that url
//   is the `fetch-report/{uuid}` address itself, ready to poll.
// - `fetch-report` answers 302 once the report exists; while it does not,
//   the REST reference says 202 and the announcement says 201 - both are read
//   as "not yet". The redirect points at a short-lived signed blob url on
//   another host, fetched without the GitHub token.
// - The blob is the SPDX document itself, not `{ sbom: ... }` as the
//   synchronous endpoint wrapped it; both shapes are read.
// - Its own rate limit bucket: `x-ratelimit-resource: dependency_sbom`, 100.
//
// What could not be had is said as that, never as a graph: a job that
// failed, never finished, expired, or a download that broke yields
// `unavailable`, and only a document that parses as SPDX with a package list
// yields packages - so nobody is ever told the graph is empty, or that a risk
// is gone, because a request did not come back.

export interface SpdxPackage {
  readonly name: string
  readonly versionInfo?: string
}

export interface SbomDocument {
  readonly created: string
  readonly packages: readonly SpdxPackage[]
}

export type SbomOutcome =
  | { readonly kind: 'document'; readonly document: SbomDocument }
  | { readonly kind: 'unavailable'; readonly reason: string }

export interface SbomClient {
  readonly fetch: typeof fetch
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
}

const API_VERSION = '2026-03-10'

/** how long a report may take before the run says it could not get one */
export const REPORT_DEADLINE_MS = 6 * 60_000

const DEFAULT_POLL_MS = 5_000
const MAX_WAIT_MS = 60_000
const MAX_ATTEMPTS = 5

/** how long the server asked to be left alone, if it said */
const waitAsked = (response: Response, now: number): number | undefined => {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter !== null && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000
  const poll = response.headers.get('x-poll-interval')
  if (poll !== null && /^\d+$/.test(poll)) return Number(poll) * 1000
  const reset = response.headers.get('x-ratelimit-reset')
  if (
    response.headers.get('x-ratelimit-remaining') === '0' &&
    reset !== null &&
    /^\d+$/.test(reset)
  )
    return Math.max(0, Number(reset) * 1000 - now)
  return undefined
}

/** a refusal that waiting may cure: rate limits and the server's own trouble */
const transient = (response: Response): boolean =>
  response.status === 429 ||
  response.status >= 500 ||
  (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')

/** the document's packages, or why there are none to be read */
export const readSpdx = (body: string): SbomDocument | string => {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return 'the report is not JSON'
  }
  const unwrapped: unknown =
    typeof parsed === 'object' && parsed !== null && 'sbom' in parsed ? parsed.sbom : parsed
  if (typeof unwrapped !== 'object' || unwrapped === null)
    return 'the report is not an SPDX document'
  const document: {
    spdxVersion?: unknown
    creationInfo?: { created?: unknown }
    packages?: unknown
  } = unwrapped
  if (typeof document.spdxVersion !== 'string') return 'the report is not an SPDX document'
  if (!Array.isArray(document.packages)) return 'the report has no package list'
  const packages = document.packages.filter(
    (one): one is SpdxPackage =>
      typeof one === 'object' &&
      one !== null &&
      typeof (one as { name?: unknown }).name === 'string',
  )
  return {
    created:
      typeof document.creationInfo?.created === 'string' ? document.creationInfo.created : '?',
    packages,
  }
}

/** asks GitHub to build the report, waits for it, and reads it */
export const fetchSbom = async (
  repository: string,
  token: string,
  client: SbomClient = {
    fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  },
  deadlineMs: number = REPORT_DEADLINE_MS,
): Promise<SbomOutcome> => {
  const started = client.now()
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': API_VERSION,
  }
  const unavailable = (reason: string): SbomOutcome => ({ kind: 'unavailable', reason })
  const left = () => deadlineMs - (client.now() - started)
  /** sleeps as asked, within what is left; false when there is no time for it */
  const pause = async (response: Response | undefined, fallback: number): Promise<boolean> => {
    const asked = response === undefined ? undefined : waitAsked(response, client.now())
    const wait = Math.min(asked ?? fallback, MAX_WAIT_MS)
    if (wait >= left()) return false
    await client.sleep(wait)
    return true
  }
  /** one request, retried while the refusal is one waiting may cure */
  const ask = async (url: string, init: RequestInit): Promise<Response | string> => {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response
      try {
        response = await client.fetch(url, init)
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || !(await pause(undefined, DEFAULT_POLL_MS * attempt)))
          return `the request failed: ${error instanceof Error ? error.message : String(error)}`
        continue
      }
      if (!transient(response)) return response
      if (attempt >= MAX_ATTEMPTS || !(await pause(response, DEFAULT_POLL_MS * attempt)))
        return `answered ${response.status} until it was given up on`
    }
  }

  const generated = await ask(
    `https://api.github.com/repos/${repository}/dependency-graph/sbom/generate-report`,
    { headers },
  )
  if (typeof generated === 'string') return unavailable(`generate-report ${generated}`)
  if (generated.status !== 201 && generated.status !== 200)
    return unavailable(`generate-report answered ${generated.status}`)
  let reportUrl: unknown
  try {
    reportUrl = ((await generated.json()) as { sbom_url?: unknown }).sbom_url
  } catch {
    return unavailable('generate-report answered without JSON')
  }
  if (typeof reportUrl !== 'string' || !reportUrl.startsWith('https://api.github.com/'))
    return unavailable('generate-report named no report to fetch')

  for (;;) {
    const polled = await ask(reportUrl, { headers, redirect: 'manual' })
    if (typeof polled === 'string') return unavailable(`fetch-report ${polled}`)
    if (polled.status === 201 || polled.status === 202) {
      if (!(await pause(polled, DEFAULT_POLL_MS)))
        return unavailable(`the report was not ready within ${Math.round(deadlineMs / 1000)}s`)
      continue
    }
    if (polled.status === 404)
      return unavailable('fetch-report answered 404: the job failed, expired, or never existed')
    if (polled.status !== 302 && polled.status !== 301 && polled.status !== 307)
      return unavailable(`fetch-report answered ${polled.status}`)
    const location = polled.headers.get('location')
    if (location === null || !location.startsWith('https://'))
      return unavailable('fetch-report redirected nowhere usable')
    // a signed url on another host: the GitHub token stays behind
    const downloaded = await ask(location, {})
    if (typeof downloaded === 'string') return unavailable(`the download ${downloaded}`)
    if (!downloaded.ok) return unavailable(`the download answered ${downloaded.status}`)
    let body: string
    try {
      body = await downloaded.text()
    } catch (error) {
      return unavailable(
        `the download broke off: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const document = readSpdx(body)
    return typeof document === 'string' ? unavailable(document) : { kind: 'document', document }
  }
}
