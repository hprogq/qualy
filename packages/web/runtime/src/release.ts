import {
  QUALY_RELEASE_CHANNEL,
  QUALY_RELEASE_ENDPOINT,
  isReleaseObserved,
  isReleaseProbe,
  type ReleaseProbe,
  type WebReleaseIdentity,
} from '@qualy/release-contract'

// The browser's side of the release protocol: one coordinator per page,
// created by the composition root with the identity the bundle carries.
//
// A page is a long-lived client. It learns that the server has moved on by
// asking the release endpoint - when it comes back into view (throttled),
// when it is restored from the back-forward cache, when the network comes
// back - and by hearing from other tabs of the same origin. A newer
// release is news, not an emergency: the page goes on working and says so
// once. Two things are emergencies, because the page cannot go on: a chunk
// it needs failing to load (Vite's preload error), and the server refusing
// this page's protocol. Then the only way out is a whole reload, and the
// page says so and waits - it never reloads on its own, since somebody may
// be halfway through a form.
//
// A failed probe is a failed probe, never "updated": a background check
// that fails is ignored, and a chunk failure whose probe also fails is a
// loading failure, not a release skew. Only equality of release ids says
// anything about updates.
//
// Everything a browser gives is injectable - fetch, the clock, the window
// and document, the channel, the reload - so the state machine is tested
// without one. This module imports no virtual module and no React.

export type ReloadReason = 'release-skew' | 'asset-load-failed' | 'client-protocol'

export type ReleaseState =
  | { readonly kind: 'current' }
  | { readonly kind: 'update-available'; readonly latest: ReleaseProbe }
  | {
      readonly kind: 'reload-required'
      readonly reason: ReloadReason
      readonly latest?: ReleaseProbe
    }

export interface CheckOptions {
  /** ask even inside the throttle window */
  readonly force?: boolean
}

/** the least a window, a document or a channel must be for the coordinator */
export interface EventTargetLike {
  addEventListener(type: string, listener: (event: any) => void, options?: boolean): void
  removeEventListener(type: string, listener: (event: any) => void, options?: boolean): void
}

export interface DocumentLike extends EventTargetLike {
  readonly visibilityState: string
}

export interface ChannelLike {
  postMessage(message: unknown): void
  close(): void
  onmessage: ((event: { readonly data: unknown }) => void) | null
}

export interface ReleaseCoordinatorOptions {
  /** the release this page runs */
  readonly current: WebReleaseIdentity
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>
  /** milliseconds, as performance.now or Date.now give them */
  readonly now?: () => number
  readonly window?: EventTargetLike
  readonly document?: DocumentLike
  /** `null` for no channel; unless given, the origin's channel where the browser has one */
  readonly channel?: ChannelLike | null
  readonly reload?: () => void
  /** how long a visibility change waits since the last check before asking again */
  readonly throttleMs?: number
}

export interface ReleaseCoordinator {
  subscribe(listener: () => void): () => void
  getSnapshot(): ReleaseState
  /** ask the host which release it serves; resolves with the answer, or nothing on failure or throttle */
  check(options?: CheckOptions): Promise<ReleaseProbe | undefined>
  /** the reader has seen the notice for this release; not again for the same one */
  dismissAvailable(): void
  /** the page can no longer go on: block until a reload */
  requireReload(reason: ReloadReason, latest?: ReleaseProbe): void
  /** the server refused this page's protocol (from the api transport) */
  notifyClientUnsupported(): void
  reload(): void
  /** listen to the browser; idempotent */
  start(): void
  stop(): void
}

const CURRENT: ReleaseState = { kind: 'current' }
const FIVE_MINUTES = 5 * 60_000

// the browser's channel behind the small interface above, so a test's
// channel and the browser's are the same thing to the coordinator
const defaultChannel = (): ChannelLike | null => {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(QUALY_RELEASE_CHANNEL)
  const adapter: ChannelLike = {
    postMessage: (message) => channel.postMessage(message),
    close: () => channel.close(),
    onmessage: null,
  }
  channel.onmessage = (event) => adapter.onmessage?.(event)
  return adapter
}

export function createReleaseCoordinator(options: ReleaseCoordinatorOptions): ReleaseCoordinator {
  const { current } = options
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))
  const now = options.now ?? (() => Date.now())
  const throttleMs = options.throttleMs ?? FIVE_MINUTES
  const reload = options.reload ?? (() => window.location.reload())
  const win = options.window ?? (typeof window === 'undefined' ? undefined : window)
  const doc = options.document ?? (typeof document === 'undefined' ? undefined : document)

  let state: ReleaseState = CURRENT
  const listeners = new Set<() => void>()
  let lastCheck = now()
  let inFlight: Promise<ReleaseProbe | undefined> | undefined
  let dismissed: string | undefined
  let channel: ChannelLike | null | undefined
  let started = false

  const set = (next: ReleaseState) => {
    if (next === state) return
    state = next
    for (const listener of listeners) listener()
  }

  const blocked = () => state.kind === 'reload-required'

  /** a release other than this page's has been seen: news, unless the reader dismissed it or the page is already blocked */
  const observed = (probe: ReleaseProbe) => {
    if (probe.releaseId === current.releaseId) {
      if (state.kind === 'update-available') set(CURRENT)
      return
    }
    if (blocked() || dismissed === probe.releaseId) return
    if (state.kind === 'update-available' && state.latest.releaseId === probe.releaseId) return
    set({ kind: 'update-available', latest: probe })
  }

  const probe = async (): Promise<ReleaseProbe | undefined> => {
    try {
      const response = await doFetch(QUALY_RELEASE_ENDPOINT, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return undefined
      const body: unknown = await response.json()
      return isReleaseProbe(body) ? body : undefined
    } catch {
      return undefined
    }
  }

  const check: ReleaseCoordinator['check'] = (checkOptions = {}) => {
    if (inFlight !== undefined) return inFlight
    if (!checkOptions.force && now() - lastCheck < throttleMs) return Promise.resolve(undefined)
    inFlight = probe().then((answer) => {
      inFlight = undefined
      if (answer === undefined) return undefined
      lastCheck = now()
      observed(answer)
      if (answer.releaseId !== current.releaseId) {
        channel?.postMessage({ type: 'release-observed', probe: answer })
      }
      return answer
    })
    return inFlight
  }

  const requireReload: ReleaseCoordinator['requireReload'] = (reason, latest) => {
    // a block is never softened: a later, milder finding does not unblock
    if (blocked()) return
    set(
      latest === undefined
        ? { kind: 'reload-required', reason }
        : { kind: 'reload-required', reason, latest },
    )
  }

  // a chunk this page needs did not load: ask the host why, and block either way
  const onPreloadError = (event: { preventDefault(): void }) => {
    event.preventDefault()
    void check({ force: true }).then((answer) => {
      if (answer !== undefined && answer.releaseId !== current.releaseId) {
        requireReload('release-skew', answer)
      } else {
        requireReload('asset-load-failed')
      }
    })
  }
  const onVisibility = () => {
    if (doc?.visibilityState === 'visible') void check()
  }
  const onPageShow = (event: { readonly persisted?: boolean }) => {
    // restored from the back-forward cache: this document may be old
    if (event.persisted) void check({ force: true })
  }
  const onOnline = () => {
    // the network is back: a page blocked on a loading failure asks whether
    // it was a release skew after all, which is the better thing to say
    const failed = state.kind === 'reload-required' && state.reason === 'asset-load-failed'
    void check({ force: failed }).then((answer) => {
      if (failed && answer !== undefined && answer.releaseId !== current.releaseId) {
        set({ kind: 'reload-required', reason: 'release-skew', latest: answer })
      }
    })
  }
  const onChannelMessage = (event: { readonly data: unknown }) => {
    // another tab's word, checked against the contract; a block stays this tab's own finding
    if (isReleaseObserved(event.data)) observed(event.data.probe)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => state,
    check,
    dismissAvailable() {
      if (state.kind !== 'update-available') return
      dismissed = state.latest.releaseId
      set(CURRENT)
    },
    requireReload,
    notifyClientUnsupported: () => requireReload('client-protocol'),
    reload,
    start() {
      if (started) return
      started = true
      win?.addEventListener('vite:preloadError', onPreloadError)
      win?.addEventListener('pageshow', onPageShow)
      win?.addEventListener('online', onOnline)
      doc?.addEventListener('visibilitychange', onVisibility)
      channel = options.channel === undefined ? defaultChannel() : options.channel
      if (channel) channel.onmessage = onChannelMessage
    },
    stop() {
      if (!started) return
      started = false
      win?.removeEventListener('vite:preloadError', onPreloadError)
      win?.removeEventListener('pageshow', onPageShow)
      win?.removeEventListener('online', onOnline)
      doc?.removeEventListener('visibilitychange', onVisibility)
      if (channel) {
        channel.onmessage = null
        channel.close()
      }
      channel = undefined
    },
  }
}
