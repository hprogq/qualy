import type { BrowserSurface } from '@qualy/ui-contract'
import { currentObservedPage, rememberObservedPage, type ObservedPage } from './context.ts'
import { drainEarlyFailures, stopEarlyCapture } from './queue.ts'

// How the application reports a browser failure without knowing where reports
// go.
//
// This is the platform's port, not a plugin's. Every page imports it - the
// component boundary and the route observer are in the runtime, and the
// composition root reports release skew - and a platform that imported an
// optional plugin to do that would make the plugin not optional. What is a
// plugin's is everything past this seam: which vendor, what settings, which
// sdk chunk, how a report is shaped on the wire. Installing one sink is the
// whole of what a provider does here.
//
// Nothing here may weigh anything: no api client, no schema, no vendor
// import. Asking a deployment whether it reports at all costs an api client,
// and that question belongs to whoever answers it.
//
// The contract every function keeps is that NONE OF THEM THROW and none of
// them are awaited by anything a viewer is waiting on. A reporting platform
// is allowed to be down, slow, misconfigured or absent, and the product is
// expected not to notice. Server-side telemetry is already held to this: an
// export is best effort and never an availability dependency.

export type Dispose = () => void

export interface ExceptionContext {
  /**
   * Which surface it happened on: `{kind: 'page', id: 'assessment/review'}`.
   *
   * A product address rather than the module behind it. The two are the same
   * failure, but only one of them is something the reader of a report can
   * ask about, and only one of them is safe to send off this machine.
   */
  readonly surface?: BrowserSurface
  readonly pageId?: string
  readonly route?: string
}

/**
 * Low cardinality engineering facts about something that is not an exception.
 *
 * A missing renderer or a release skew is not a crash, and dressing one up as
 * an Error would put a fabricated stack in front of whoever reads it later.
 */
export interface DiagnosticContext {
  readonly [key: string]: string | number | boolean | undefined
}

/** where reports actually go, once some provider has brought one up */
export interface ObservabilitySink {
  captureException(error: unknown, context?: ExceptionContext): void
  captureDiagnostic(code: string, context?: DiagnosticContext): void
  setPage(page: ObservedPage): void
  destroy?(): void
}

let sink: ObservabilitySink | null = null

/**
 * What the application reported while no sink existed yet.
 *
 * A sink cannot be up during the first screen: bringing one up needs the
 * deployment's settings, which is a request, and a vendor chunk - and the
 * first render happens without waiting for either, on purpose, because a
 * reporting platform must never be able to hold the product back. So the
 * failures most worth having are exactly the ones that arrive too early:
 * a page that throws on its first render reported into nothing at all, and
 * was marked as already reported on the way out, so no later path could
 * report it either.
 *
 * The window listeners next door do not cover this. They catch what reaches
 * the window; a React error boundary's report never does - that is the whole
 * reason the dedup beside them is identity-based rather than a global
 * handler's problem.
 *
 * Bounded for the same reason the early queue is: a failing render loop
 * reports thousands of times, and holding them all is a leak in the one
 * situation where the page is already in trouble.
 */
const PENDING_LIMIT = 20

type PendingReport =
  | { readonly kind: 'exception'; readonly error: unknown; readonly context: ExceptionContext }
  | { readonly kind: 'diagnostic'; readonly code: string; readonly context?: DiagnosticContext }

const pending: PendingReport[] = []
/** whether the question "does this deployment report, and where" has an answer */
let settled = false

const hold = (report: PendingReport): void => {
  if (settled || pending.length >= PENDING_LIMIT) return
  pending.push(report)
}

/** one line per distinct problem, never a line per occurrence */
const warned = new Set<string>()
const warnOnce = (key: string, cause: unknown): void => {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[qualy] browser reporting is not working (${key})`, cause)
}

/** the sink is vendor code; a throw from it must never reach the caller */
const safely = (key: string, use: (target: ObservabilitySink) => void): void => {
  if (sink === null) return
  try {
    use(sink)
  } catch (cause) {
    warnOnce(key, cause)
  }
}

/**
 * A provider's sink takes over, and is handed what failed before it existed.
 *
 * The early listeners stand down here rather than at some later moment: once
 * a sink is up it has its own global handlers, and keeping both would deliver
 * every later failure twice.
 */
export const installSink = (target: ObservabilitySink): Dispose => {
  if (sink !== null && sink !== target) {
    // two sinks would each see half the failures and neither would be
    // wrong about it, which is worse than one deployment fault said aloud
    warnOnce('install', 'a second sink was offered; the first one is kept')
    return () => undefined
  }
  sink = target
  safely('page', (installed) => installed.setPage(currentObservedPage()))
  // what the window caught before anything was listening for it, in the
  // order it happened - module evaluation comes before the first render
  for (const failure of drainEarlyFailures()) captureException(failure.error)
  // and what the application itself reported while this sink was on its way
  const held = pending.splice(0)
  settled = true
  for (const report of held) {
    if (report.kind === 'exception') {
      safely('capture', (installed) => installed.captureException(report.error, report.context))
    } else {
      safely('diagnostic', (installed) => installed.captureDiagnostic(report.code, report.context))
    }
  }
  return () => {
    if (sink !== target) return
    try {
      target.destroy?.()
    } catch (cause) {
      warnOnce('dispose', cause)
    }
    sink = null
  }
}

/**
 * Nobody is going to report: let go of what was caught early.
 *
 * Said out loud rather than left implicit, because the two outcomes have to
 * be distinguishable. A deployment that reports nowhere is ordinary; a page
 * still holding failures for a sink that will never arrive is a small leak in
 * the one situation where the page is already in trouble.
 */
export const noSinkArriving = (): void => {
  settled = true
  pending.splice(0)
  stopEarlyCapture()
}

/**
 * The same error object arriving twice is reported once.
 *
 * Identity is the whole test. React 19 was measured not to re-throw an error
 * an error boundary caught, so the boundary's report and a vendor's global
 * handler do not both fire for one failure; what remains is one object
 * travelling two code paths, and a `WeakSet` answers that exactly. A
 * fingerprint with a time window would also collapse two genuinely different
 * failures that happen to read alike, which is a worse answer to a problem
 * nothing has shown.
 */
let accounted = new WeakSet<object>()

/**
 * Whether this failure is ours to carry, or already somebody's.
 *
 * Accounted for means delivered OR held for delivery - not "captureException
 * was once called with it". Those were the same thing while a report with no
 * sink was simply dropped, and the difference is a lost first screen: the
 * error was marked on the way into a sink that did not exist yet.
 */
const account = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return true
  if (accounted.has(error)) return false
  accounted.add(error)
  return true
}

export const captureException = (error: unknown, context?: ExceptionContext): void => {
  if (!account(error)) return
  // the page as it was when this happened, not as it is when a sink finally
  // arrives and the held reports go out
  const page = currentObservedPage()
  const full: ExceptionContext = {
    ...(page.pageId === undefined ? {} : { pageId: page.pageId }),
    ...(page.route === undefined ? {} : { route: page.route }),
    ...context,
  }
  if (sink === null) {
    hold({ kind: 'exception', error, context: full })
    return
  }
  safely('capture', (target) => target.captureException(error, full))
}

/**
 * One report per fact, with a ceiling on how many facts are remembered.
 *
 * An exception is deduped by the identity of the error object; a diagnostic
 * has no object, so it is deduped by what it says - which the vocabulary is
 * built for: a closed set of codes and low-cardinality context. It needs to
 * be: the hot caller reports a missing surface from inside a RENDER, so a
 * screen that re-renders on every keystroke reported on every keystroke.
 *
 * The ceiling is generous next to a closed vocabulary and bounded anyway:
 * at the limit the oldest fact is forgotten, which costs one repeat rather
 * than unbounded memory.
 */
const DIAGNOSTIC_FACTS = 64
let reported = new Map<string, true>()

const firstTime = (code: string, context?: DiagnosticContext): boolean => {
  const key = `${code}|${context === undefined ? '' : JSON.stringify(context)}`
  if (reported.has(key)) return false
  if (reported.size >= DIAGNOSTIC_FACTS) {
    const oldest = reported.keys().next()
    if (!oldest.done) reported.delete(oldest.value)
  }
  reported.set(key, true)
  return true
}

/**
 * Something worth knowing that is not a crash: a surface the manifest
 * promised and the bundle does not have, a tab left on a release the store no
 * longer keeps. Codes are a closed vocabulary and the context is low
 * cardinality on purpose; neither is a place to put an error message.
 */
export const captureDiagnostic = (code: string, context?: DiagnosticContext): void => {
  if (!firstTime(code, context)) return
  if (sink === null) {
    // held for the same reason an exception is: a surface the manifest
    // promised and the build does not have is discovered on the first
    // render, which is before any sink exists
    hold(
      context === undefined ? { kind: 'diagnostic', code } : { kind: 'diagnostic', code, context },
    )
    return
  }
  safely('diagnostic', (target) => target.captureDiagnostic(code, context))
}

export const setObservedPage = (page: ObservedPage): void => {
  rememberObservedPage(page)
  safely('page', (target) => target.setPage(page))
}

/** test seam: module state is per page in a browser and per file in a suite */
export const resetObservability = (): void => {
  try {
    sink?.destroy?.()
  } catch {
    // a sink that cannot be torn down is not worth a warning in a reset
  }
  sink = null
  warned.clear()
  pending.splice(0)
  settled = false
  // a WeakSet cannot be emptied, and a suite's next case must be able to
  // report the same object again
  accounted = new WeakSet<object>()
  reported = new Map<string, true>()
  rememberObservedPage({})
  drainEarlyFailures()
}
