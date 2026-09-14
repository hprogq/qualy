// The failures that happen before anything is listening.
//
// A provider cannot be up this early. It needs the deployment's own settings,
// which is a request, and its vendor bundle, which is a chunk - and the
// module graph of the application runs to completion before the entry's first
// statement does. So an exception thrown while the app's own imports evaluate,
// which is exactly the kind worth knowing about, would happen with nobody to
// tell.
//
// What runs this early is therefore as small as it can be: two listeners and
// an array. No network, no storage, no DOM, nothing read off the session. The
// array is bounded because a failing render loop can throw thousands of times,
// and holding them all would be a leak in the one situation where the page is
// already in trouble.

/** enough to see what started it; past this the rest say the same thing */
const LIMIT = 20

export interface EarlyFailure {
  readonly error: unknown
  readonly kind: 'error' | 'rejection'
}

const held: EarlyFailure[] = []
let listening = false

const onError = (event: ErrorEvent) => {
  // An element that failed to load does not reach here: resource errors do
  // not bubble, and this listener is not a capturing one. That is deliberate -
  // a failed chunk is the release coordinator's business, and a provider
  // reports resource failures itself once it is up.
  if (held.length < LIMIT) {
    held.push({ error: event.error ?? new Error(event.message), kind: 'error' })
  }
}

const onRejection = (event: PromiseRejectionEvent) => {
  if (held.length < LIMIT) held.push({ error: event.reason, kind: 'rejection' })
}

/** called by the bootstrap module, which the entry imports before anything else */
export const installEarlyListeners = (): void => {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
}

/**
 * Hands over what was missed and stands down.
 *
 * Once a provider is up it has its own global handlers, and keeping these
 * would mean every later failure arriving twice.
 */
export const drainEarlyFailures = (): readonly EarlyFailure[] => {
  if (listening && typeof window !== 'undefined') {
    listening = false
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
  return held.splice(0)
}
