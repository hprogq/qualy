import { surfaceLabel } from '@qualy/ui-contract'
import {
  observedPageUrl,
  type DiagnosticContext,
  type ExceptionContext,
  type ObservabilitySink,
} from '@qualy/browser-observability'
import type { BrowserRumProvider } from '@qualy/plugin-rum/client'
import { isTencentRumPublicConfig, TENCENT_RUM_HOST } from '../settings.ts'
import { rumVersionForRelease } from '../version.ts'
import { beforeReport, beforeRequest } from './privacy.ts'

/** the class the runtime actually hands over; see the note where it is loaded */
type AegisConstructor = (typeof import('aegis-web-sdk'))['default']

// The vendor half: this is the only file in the repository that knows what
// Aegis is.
//
// The sdk is fetched when a deployment turns reporting on, not when a page
// boots. A production build is a superset of every installed plugin, so the
// module that registers this provider runs on every page load of every
// deployment - including ones that report nowhere - and a static import here
// would have put 128 KB of vendor sdk in front of all of them. Registering
// costs a name and a function; the sdk is the cost of actually reporting.

/** what a report says happened, from whatever was thrown */
const message = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack === undefined
      ? `${error.name}: ${error.message}`
      : `${error.name}: ${error.message}\n${error.stack}`
  }
  return `NonError: ${String(error)}`
}

/**
 * A diagnostic's context on one line, sorted so the same facts always read the
 * same way.
 *
 * One field rather than a field per key: the vendor's extra slots are
 * positional, and mapping arbitrary keys onto positions would mean the same
 * diagnostic landing in different columns depending on which keys it happened
 * to carry. Keeping it low cardinality is the caller's business, which is why
 * the capability types these values as scalars.
 */
const oneLine = (context: DiagnosticContext | undefined): string =>
  context === undefined
    ? ''
    : Object.entries(context)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(';')

export const tencentRumProvider: BrowserRumProvider = {
  async start(config, release): Promise<ObservabilitySink | null> {
    // the capability hands the provider's settings over verbatim; a
    // deployment whose configuration does not decode is one that reports
    // nothing, not one that throws on every page
    if (!isTencentRumPublicConfig(config)) return null

    // The package is a UMD bundle whose wrapper does `module.exports = Aegis`
    // with no `__esModule` marker, while its one d.ts says `export default
    // Aegis`. So the types carry one `default` more than the runtime does:
    // typescript reads the namespace's `default` as the module object, and
    // the bundler hands over the class itself. The cast re-aligns the type
    // with the value and keeps the constructor's real signature; the browser
    // suite constructs one, which is what would catch this going stale.
    const loaded = await import('aegis-web-sdk')
    const Aegis = loaded.default as unknown as AegisConstructor
    const aegis = new Aegis({
      id: config.id,
      hostUrl: TENCENT_RUM_HOST,
      version: rumVersionForRelease(release.releaseId),
      env: config.environment,
      random: config.sampleRate,
      // the sdk's own default is 60 identical reports before it stops; this
      // product would rather see the first handful and the count
      repeat: 5,

      // no persistent identity for a browser, and never a user's: what is
      // being diagnosed is a build, not a person
      aid: false,
      uin: '',
      spa: false,

      onError: true,
      // verified to arrive even though the sdk starts this late
      pagePerformance: { urlHandler: observedPageUrl },
      webVitals: true,

      // With api speed off the sdk raises no ajax errors at all, which was
      // measured against 200, 404, 500 and a dropped connection through both
      // fetch and XHR. That is the whole reason this is off in the first
      // phase: this product answers 4xx as ordinary domain outcomes, and they
      // would have filled the error panel with things that are not failures.
      reportApiSpeed: false,
      reportAssetSpeed: false,

      blankScreen: false,
      consoleLog: false,
      clickElementLog: false,
      websocketHack: false,
      lagMonitor: { enabled: false },

      // never the request or the response: the bodies here are a student's
      // material and a reviewer's decision
      api: { apiDetail: false, reportRequest: false, reqHeaders: [] },

      // The compressing worker is built from a blob url, which the shell's
      // policy refuses - `worker-src 'self'`. The sdk survives it, falling
      // back to the main thread when the worker errors, but the browser still
      // records a violation, and this product's policy is enforced with a gate
      // that reads violations. Widening the policy for a compression detail
      // would be the wrong trade: the reports are small.
      gzip: { useWorker: false },

      // governs `from` on every report; zero argument, so it reads the page
      // the runtime last observed
      urlHandler: observedPageUrl,
      beforeReport,
      beforeRequest,
    })

    // The referer bean is read from `document.referrer` when the instance is
    // constructed and then rides every request url this sdk makes. No setting
    // reaches it, and the page a viewer arrived from is not this deployment's
    // to send anywhere.
    aegis.extendBean('referer', '')

    return {
      captureException(error: unknown, context?: ExceptionContext) {
        aegis.error({
          msg: message(error),
          ext1: context?.pageId ?? '',
          ext2: context?.surface?.kind ?? '',
          ext3: context?.surface === undefined ? '' : surfaceLabel(context.surface),
        })
      },

      captureDiagnostic(code: string, context?: DiagnosticContext) {
        // a custom event, not an error: a missing component has no stack, and
        // inventing one would put a fiction in front of whoever reads it
        aegis.reportEvent({ name: code, ext1: oneLine(context) })
      },

      setPage() {
        // Nothing to do, and that is by design rather than an omission: the
        // handlers above read the observed page through `observedPageUrl` at
        // the moment the sdk asks, and the capability has already stored it
        // before calling here.
      },

      destroy() {
        aegis.destroy()
      },
    }
  },
}
