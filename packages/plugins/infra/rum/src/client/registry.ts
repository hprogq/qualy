import type { BrowserSurface } from '@qualy/ui-contract'
import { drainEarlyFailures } from './queue.ts'
import { currentObservedPage, rememberObservedPage, type ObservedPage } from './context.ts'

// How the application reports a browser failure without knowing where reports
// go.
//
// Nothing here may import an api client, a schema, or anything else of any
// size. Every page imports this module - the component boundary and the route
// observer are in the runtime - and so does every provider's registration
// module, which a production build evaluates on every page load whether that
// deployment reports or not. Asking the server for the settings therefore
// lives next door in `start.ts`, which the composition root imports once.
//
// A page calls `captureException(error, { surface })`. It
// never branches on the provider, never imports a vendor sdk, and never sees a
// reporting id - which is the point: the day a deployment moves from one
// platform to another, nothing on any screen changes. The same shape the
// upload side already has, where a form calls `upload(ticket, file)` and does
// not know whether the bytes end up on a disk or in a bucket.
//
// The contract every function here keeps is that NONE OF THEM THROW and none
// of them are awaited by anything a viewer is waiting on. A reporting platform
// is allowed to be down, slow, misconfigured or absent, and the product is
// expected not to notice. Server-side telemetry is already held to this: an
// export is best effort and never an availability dependency.

export type { ObservedPage } from './context.ts'
export { observedPageUrl } from './context.ts'
export { sanitizePath, sanitizeUrl } from './sanitize.ts'

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
 * A missing component or a release skew is not a crash, and dressing one up as
 * an Error would put a fabricated stack in front of whoever reads it later.
 */
export interface DiagnosticContext {
  readonly [key: string]: string | number | boolean | undefined
}

export interface BrowserRumSink {
  captureException(error: unknown, context?: ExceptionContext): void
  captureDiagnostic(code: string, context?: DiagnosticContext): void
  setPage(page: ObservedPage): void
  destroy?(): void
}

/** what the browser is running, which only the bundle knows */
export interface ObservedRelease {
  readonly releaseId: string
  readonly mode: 'development' | 'production'
}

export interface BrowserRumProvider {
  /** the code its plugin declared to the assembly */
  readonly provider: string
  /**
   * Brings the vendor sdk up with this deployment's settings.
   *
   * `null` for "configured off" rather than a throw: a provider that decides
   * it has nothing to do is the normal disabled case. Whatever it costs - a
   * vendor bundle, a handshake - is paid here and never in the boot graph.
   */
  start(config: Record<string, unknown>, release: ObservedRelease): Promise<BrowserRumSink | null>
}

const providers = new Map<string, BrowserRumProvider>()
let sink: BrowserRumSink | null = null
let started = false

/** one line per distinct problem, never a line per occurrence */
const warned = new Set<string>()
const warnOnce = (key: string, cause: unknown): void => {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[qualy] browser reporting is not working (${key})`, cause)
}

/** the sink is vendor code; a throw from it must never reach the caller */
const safely = (key: string, use: (target: BrowserRumSink) => void): void => {
  if (sink === null) return
  try {
    use(sink)
  } catch (cause) {
    warnOnce(key, cause)
  }
}

/**
 * A provider offering its browser half.
 *
 * Called by the provider's own browser module, which every page evaluates -
 * so it must stay this cheap. Registering costs a name and a function, and
 * whether this deployment reports at all is decided in `startBrowserRum`.
 */
export const registerRumProvider = (provider: BrowserRumProvider): void => {
  const existing = providers.get(provider.provider)
  if (existing !== undefined && existing !== provider) {
    warnOnce(provider.provider, 'registered twice; the second registration was ignored')
    return
  }
  providers.set(provider.provider, provider)
}

/**
 * Brings up the provider this deployment named, then hands it the failures
 * from before it existed.
 *
 * Called by `startBrowserRum`, which lives next door because asking the server
 * what the settings are costs an api client, and this module is imported by
 * every page. A failure here is warned about once and changes nothing else.
 */
export const activateRumProvider = async (
  selected: string | null,
  config: Record<string, unknown>,
  release: ObservedRelease,
): Promise<void> => {
  if (started) return
  started = true
  try {
    if (selected !== null) {
      const provider = providers.get(selected)
      if (provider === undefined) {
        // the assembly selected a provider whose browser half is not in this
        // build, which is a deployment fault rather than anything a viewer did
        warnOnce(selected, 'the selected provider is not part of this build')
      } else {
        sink = await provider.start(config, release)
        if (sink !== null) safely('page', (target) => target.setPage(currentObservedPage()))
      }
    }
  } catch (cause) {
    warnOnce('start', cause)
  }
  // Only now: a failure during the await above still belongs to the queue, and
  // the listeners must not outlive the provider's own global handlers.
  const early = drainEarlyFailures()
  if (sink === null) return
  for (const failure of early) captureException(failure.error)
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
const reported = new WeakSet<object>()

export const captureException = (error: unknown, context?: ExceptionContext): void => {
  if (typeof error === 'object' && error !== null) {
    if (reported.has(error)) return
    reported.add(error)
  }
  const page = currentObservedPage()
  const full: ExceptionContext = {
    ...(page.pageId === undefined ? {} : { pageId: page.pageId }),
    ...(page.route === undefined ? {} : { route: page.route }),
    ...context,
  }
  safely('capture', (target) => target.captureException(error, full))
}

/**
 * Something worth knowing that is not a crash: a component the manifest
 * promised and the bundle does not have, a tab left on a release the store no
 * longer keeps. Codes are a closed vocabulary and the context is low
 * cardinality on purpose; neither is a place to put an error message.
 */
export const captureDiagnostic = (code: string, context?: DiagnosticContext): void => {
  safely('diagnostic', (target) => target.captureDiagnostic(code, context))
}

export const setObservedPage = (page: ObservedPage): void => {
  rememberObservedPage(page)
  safely('page', (target) => target.setPage(page))
}

/** test seam: module state is per page in a browser and per file in a suite */
export const resetBrowserRum = (): void => {
  providers.clear()
  try {
    sink?.destroy?.()
  } catch {
    // a sink that cannot be torn down is not worth a warning in a reset
  }
  sink = null
  started = false
  warned.clear()
  rememberObservedPage({})
  drainEarlyFailures()
}
