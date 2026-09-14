// The browser's reporting port: the vocabulary every page may use, and
// nothing that weighs anything.
//
// A page says `captureException(error, { surface })`. It never branches on a
// provider, never imports a vendor sdk and never sees a reporting id - which
// is the point: the day a deployment moves from one platform to another,
// nothing on any screen changes. The same shape the upload side has, where a
// form calls `upload(ticket, file)` and does not know whether the bytes end
// up on a disk or in a bucket.
//
// It lives in the platform because the platform is what calls it: the
// component boundary, the route observer, the composition root. Those may not
// depend on an optional plugin - a product with reporting switched off is
// still a product, and its runtime must not notice.

export type { ObservedPage } from './context.ts'
export { currentObservedPage, observedPageUrl } from './context.ts'
export { sanitizePath, sanitizeUrl } from './sanitize.ts'
export type { EarlyFailure } from './queue.ts'
export { installEarlyListeners } from './queue.ts'
export type { Dispose, DiagnosticContext, ExceptionContext, ObservabilitySink } from './sink.ts'
export {
  captureDiagnostic,
  captureException,
  installSink,
  noSinkArriving,
  resetObservability,
  setObservedPage,
} from './sink.ts'
