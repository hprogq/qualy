// The browser api every page imports: the vocabulary, and nothing that weighs
// anything.
//
// Split from `start.ts` on purpose rather than by taste. The component
// boundary and the route observer live in the runtime, so this module is on
// the eager path of every page, and every provider's registration module
// imports it too. Asking the server which provider a deployment selected needs
// an api client, which is 129 KB of schema and http machinery - already paid
// for elsewhere in the application, but not something a provider's
// announcement should drag along. So the question lives next door, where the
// composition root asks it once.

export type { ObservedPage } from './context.ts'
export { observedPageUrl } from './context.ts'
export { sanitizePath, sanitizeUrl } from './sanitize.ts'
export type {
  BrowserRumProvider,
  BrowserRumSink,
  DiagnosticContext,
  ExceptionContext,
  ObservedRelease,
} from './registry.ts'
export {
  activateRumProvider,
  captureDiagnostic,
  captureException,
  registerRumProvider,
  resetBrowserRum,
  setObservedPage,
} from './registry.ts'
