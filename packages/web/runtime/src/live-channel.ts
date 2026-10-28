import { Effect, Fiber } from 'effect'
import { Socket } from 'effect/socket'
import type { ClientUnsupportedReason } from '@qualy/release-contract'
import {
  LIVE_CLOSE,
  LIVE_PONG,
  LIVE_PROTOCOL_PARAM,
  LIVE_RELEASE_PARAM,
  LIVE_SILENCE_MS,
  LIVE_SUBPROTOCOL,
  liveCloseVerdict,
  unsupportedReasonOf,
} from '@qualy/api-kit/live-socket'
import type { ClientIdentity } from './api.ts'

// A tab's live channels (@qualy/api-kit/live-socket): one connection per
// identity and address, however many screens hold it.
//
// Two screens of one batch - the page and a drawer, a page and the one the
// router is bringing in - used to dial a stream each, and a session has six
// seats on the server: a reader with three tabs open was out of seats. So a
// channel is held, not opened. The first holder dials; the last to let go
// starts a short grace, and a holder that arrives inside it - the remount of
// a strict-mode effect, the next page of the same batch - finds the
// connection still open. What is shared is bounded: per identity, so the
// next person signed in never inherits a connection; per address, so one
// connection is one batch; and per tab, so nothing here outlives the page.
//
// Every connection is a generation. Whatever a connection's callbacks say
// after its channel has moved on - dialled again, let go, its identity
// signed out - speaks for a connection that is gone, and is dropped.
//
// How a connection ended decides what comes next, by its close code. A
// renewal dials again at once. A seat refused waits for one, longer each
// time and never in step with anyone else; the screen goes on polling and
// says it is restoring. An outage backs away the same way, and comes back
// sooner when the network or the tab does. A session gone, a refusal and an
// unsupported page stop dialling and hand over to the flows that own them.
// Nothing is ever dialled in a loop at a fixed rate.

/** where a channel stands, as a holder is told */
export interface LiveChannelState {
  /** the connection open now has said `sync`; without it, lean on polling */
  readonly live: boolean
  /**
   * the channel is down for real, rather than between a connection that
   * lasted and its renewal - the one a reader may be told about
   */
  readonly lost: boolean
  /** the channel has said `sync` since it was opened under this identity */
  readonly heard: boolean
  /** every seat is taken; the channel is waiting for one, and the screen polls */
  readonly waiting: boolean
}

const QUIET: LiveChannelState = { live: false, lost: false, heard: false, waiting: false }

/** how long a socket may take to open before the dial counts as failed */
const OPEN_TIMEOUT_MS = 10_000
/** how long a dial may go without `sync` before the channel counts as lost */
const ANSWER_MS = 5_000
/** a connection that lasted this long proved steady; the next wait starts over */
const STEADY_MS = 15_000
/** how often a connection checks it has heard from the server lately */
const WATCH_MS = 5_000
/** how long a channel nobody holds stays open for the next holder */
export const LIVE_GRACE_MS = 3_000
/** the frame size a server word cannot reach; past it the connection is broken */
const FRAME_LIMIT = 1_024

const RETRY = { floor: 1_000, cap: 30_000 } as const
const QUOTA = { floor: 4_000, cap: 60_000 } as const
/** a renewal waits a moment, so connections made together do not renew together */
const RENEW_SPREAD_MS = 1_000

/** every wait a channel keeps, in milliseconds; a harness shortens them */
export interface LiveTiming {
  readonly openTimeout: number
  readonly answer: number
  readonly steady: number
  readonly watch: number
  readonly silence: number
  readonly grace: number
  readonly renewSpread: number
  readonly retry: { readonly floor: number; readonly cap: number }
  readonly quota: { readonly floor: number; readonly cap: number }
}

const TIMING: LiveTiming = {
  openTimeout: OPEN_TIMEOUT_MS,
  answer: ANSWER_MS,
  steady: STEADY_MS,
  watch: WATCH_MS,
  silence: LIVE_SILENCE_MS,
  grace: LIVE_GRACE_MS,
  renewSpread: RENEW_SPREAD_MS,
  retry: RETRY,
  quota: QUOTA,
}

/**
 * The wait before the next dial: doubling from the floor up to the cap, and
 * drawn from the upper half of that, so a hundred tabs refused at once come
 * back spread over seconds rather than in one knock.
 */
export function liveBackoffMs(
  attempt: number,
  bounds: { readonly floor: number; readonly cap: number },
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(bounds.cap, bounds.floor * 2 ** Math.min(attempt, 16))
  return Math.round(ceiling * (0.5 + random() * 0.5))
}

/** what one holder hears of a channel */
export interface LiveHolder {
  readonly onMessage: (kind: string) => void
  readonly onState: (state: LiveChannelState) => void
}

export interface LiveChannelsOptions {
  /** makes the socket; the page's own WebSocket unless a harness brings one */
  readonly webSocket?: Socket.WebSocketConstructor['Service']
  /** who the page is, said in the query since a WebSocket carries no headers */
  readonly clientIdentity?: ClientIdentity
  /** the session is gone: the runtime's flow for a session lost */
  readonly onSessionLost?: () => void
  /** this page cannot talk to this server: the release coordinator's */
  readonly onClientUnsupported?: (reason: ClientUnsupportedReason) => void
  /** the address the page is at; the location's, unless a harness says */
  readonly base?: () => string
  readonly now?: () => number
  readonly random?: () => number
  readonly timing?: Partial<LiveTiming>
}

type ChannelOptions = Required<Omit<LiveChannelsOptions, 'clientIdentity' | 'base' | 'timing'>> & {
  readonly timing: LiveTiming
}

/** how a connection ended: its close code and reason, and whether it ever said sync */
interface Outcome {
  readonly code: number
  readonly reason: string
}

const globalWebSocket: Socket.WebSocketConstructor['Service'] = (url, options) =>
  new globalThis.WebSocket(url, options as string | string[] | undefined)

/** the kind a server frame names, or nothing where it is not a word of this protocol */
const kindOf = (frame: Uint8Array | string): string | undefined => {
  if (typeof frame !== 'string' || frame.length > FRAME_LIMIT) return undefined
  try {
    const parsed = JSON.parse(frame) as { kind?: unknown }
    return typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.kind === 'string' &&
      /^[a-z][a-z-]{0,39}$/.test(parsed.kind)
      ? parsed.kind
      : undefined
  } catch {
    return undefined
  }
}

const outcomeOf = (error: Socket.SocketError): Outcome =>
  error.reason._tag === 'SocketCloseError'
    ? { code: error.reason.code, reason: error.reason.closeReason ?? '' }
    : { code: 1006, reason: '' }

/**
 * One connection, from dial to end, over effect's Socket. It answers every
 * heartbeat, hands every other word on, and ends itself when the server has
 * been silent for longer than two heartbeats - a laptop that slept, a
 * network that went without a word.
 */
const connect = (
  url: string,
  webSocket: Socket.WebSocketConstructor['Service'],
  now: () => number,
  timing: LiveTiming,
  hooks: { readonly heard: (at: number) => void; readonly message: (kind: string) => void },
): Effect.Effect<Outcome> =>
  Effect.scoped(
    Effect.gen(function* () {
      const socket = yield* Socket.makeWebSocket(url, {
        protocols: LIVE_SUBPROTOCOL,
        openTimeout: timing.openTimeout,
      })
      const { pull } = yield* socket.reader
      const { write } = yield* socket.writer
      let heardAt = now()
      const reading = Effect.gen(function* () {
        for (;;) {
          const frames = yield* pull
          heardAt = now()
          hooks.heard(heardAt)
          for (const frame of frames) {
            const kind = kindOf(frame)
            if (kind === undefined) {
              return { code: LIVE_CLOSE.policy, reason: 'unexpected message' } satisfies Outcome
            }
            if (kind === 'heartbeat') yield* write(LIVE_PONG)
            else hooks.message(kind)
          }
        }
      }).pipe(
        // a race ends on the first branch to SUCCEED, so the end of the
        // socket is an answer here, not a failure the race would wait past
        Effect.catch((error: Socket.SocketError) => Effect.succeed(outcomeOf(error))),
      )
      const watching = Effect.gen(function* () {
        for (;;) {
          yield* Effect.sleep(timing.watch)
          if (now() - heardAt > timing.silence) {
            return { code: LIVE_CLOSE.unresponsive, reason: 'silent' } satisfies Outcome
          }
        }
      })
      return yield* Effect.raceAll([reading, watching])
    }),
  ).pipe(
    Effect.provideService(Socket.WebSocketConstructor, webSocket),
    Effect.catch((error: Socket.SocketError) => Effect.succeed(outcomeOf(error))),
  )

class Channel {
  readonly holders = new Set<LiveHolder>()
  state: LiveChannelState = QUIET
  private generation = 0
  private fiber: Fiber.Fiber<Outcome> | undefined
  /** the next dial, or the end of the grace */
  private timer: ReturnType<typeof setTimeout> | undefined
  private answer: ReturnType<typeof setTimeout> | undefined
  private retries = 0
  private refusals = 0
  private syncedAt: number | undefined
  /** when the connection open now last heard from the server */
  private heardAt: number | undefined
  /** the next dial is a wait for a seat or for the network, not the grace */
  waitingFor: 'seat' | 'network' | undefined
  stopped = false
  disposed = false

  constructor(
    readonly url: string,
    private readonly options: ChannelOptions,
    private readonly ended: (channel: Channel, admitted: boolean) => void,
  ) {}

  private set(next: Partial<LiveChannelState>) {
    const merged = { ...this.state, ...next }
    if (
      merged.live === this.state.live &&
      merged.lost === this.state.lost &&
      merged.heard === this.state.heard &&
      merged.waiting === this.state.waiting
    ) {
      return
    }
    this.state = merged
    for (const holder of this.holders) holder.onState(merged)
  }

  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private clearAnswer() {
    if (this.answer !== undefined) clearTimeout(this.answer)
    this.answer = undefined
  }

  /** dial now: the first holder, a renewal, a wait that is over */
  dial() {
    if (this.disposed || this.stopped) return
    this.clearTimer()
    this.waitingFor = undefined
    const generation = ++this.generation
    if (this.fiber !== undefined) void Effect.runFork(Fiber.interrupt(this.fiber))
    this.syncedAt = undefined
    this.heardAt = undefined
    this.clearAnswer()
    // a dial that stays unanswered is a line lost; one this channel has
    // never heard on is not a line at all, which is the holder's to judge
    this.answer = setTimeout(() => {
      if (generation === this.generation) this.set({ lost: true })
    }, this.options.timing.answer)
    const fiber = Effect.runFork(
      connect(this.url, this.options.webSocket, this.options.now, this.options.timing, {
        heard: (at) => {
          if (generation === this.generation) this.heardAt = at
        },
        message: (kind) => {
          if (generation !== this.generation) return
          if (kind === 'sync') {
            this.syncedAt = this.options.now()
            this.refusals = 0
            this.clearAnswer()
            this.set({ live: true, lost: false, heard: true, waiting: false })
          }
          for (const holder of this.holders) holder.onMessage(kind)
        },
      }),
    )
    this.fiber = fiber
    fiber.addObserver((exit) => {
      if (generation !== this.generation || this.disposed) return
      this.fiber = undefined
      this.clearAnswer()
      this.settle(exit._tag === 'Success' ? exit.value : { code: 1006, reason: '' })
    })
  }

  private schedule(ms: number, waitingFor: 'seat' | 'network' | undefined) {
    this.clearTimer()
    this.waitingFor = waitingFor
    this.timer = setTimeout(() => this.dial(), ms)
  }

  private settle(outcome: Outcome) {
    const now = this.options.now()
    const synced = this.syncedAt
    const timing = this.options.timing
    const steady = synced !== undefined && now - synced >= timing.steady
    this.syncedAt = undefined
    const verdict = liveCloseVerdict(outcome.code)
    // waiting for a seat is said only while the server is saying so: a
    // refusal followed by a dropped network is a line lost, not a full house
    this.set({ live: false, ...(verdict === 'quota' ? {} : { waiting: false }) })
    if (synced !== undefined) this.ended(this, true)
    switch (verdict) {
      case 'renew':
        this.retries = 0
        this.schedule(Math.round(this.options.random() * timing.renewSpread), undefined)
        return
      case 'quota':
        this.set({ lost: true, waiting: true })
        this.schedule(liveBackoffMs(this.refusals++, timing.quota, this.options.random), 'seat')
        return
      case 'retry':
        if (steady) this.retries = 0
        // a connection that lasted and dropped is followed by a dial that
        // normally answers within seconds, and that dial's own allowance
        // says whether anything was lost; one that never lasted is lost now
        if (!steady) this.set({ lost: true })
        this.schedule(liveBackoffMs(this.retries++, timing.retry, this.options.random), 'network')
        return
      case 'unauthenticated':
        this.stop()
        this.options.onSessionLost()
        return
      case 'forbidden':
        this.stop()
        return
      case 'unsupported':
        this.stop()
        this.options.onClientUnsupported(unsupportedReasonOf(outcome.reason))
        return
    }
  }

  /** dial again, soon and spread, if this channel is waiting on what just came back */
  nudge(reason: 'seat' | 'network') {
    if (this.disposed || this.stopped || this.waitingFor !== reason) return
    if (reason === 'network') this.retries = 0
    this.schedule(250 + Math.round(this.options.random() * 750), reason)
  }

  /** the tab is back, or the network is: a connection silent past its allowance goes */
  check() {
    if (this.disposed || this.stopped) return
    if (this.waitingFor === 'network') return this.nudge('network')
    // A tab that slept kept a connection that may be long dead: its own
    // watch would find out, but a hidden tab's timers run late and the
    // reader is looking now. Silent past its allowance, it is dialled again.
    const heardAt = this.heardAt
    if (
      this.fiber !== undefined &&
      heardAt !== undefined &&
      this.options.now() - heardAt > this.options.timing.silence
    ) {
      if (this.syncedAt !== undefined) this.ended(this, true)
      this.set({ live: false })
      this.dial()
    }
  }

  private stop() {
    this.stopped = true
    this.clearTimer()
    this.clearAnswer()
    this.waitingFor = undefined
    // the screen stops saying anything about a line it no longer keeps
    this.set({ live: false, lost: false, heard: false, waiting: false })
  }

  /** let go for good: nothing this channel started may speak afterwards */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.clearTimer()
    this.clearAnswer()
    const admitted = this.syncedAt !== undefined
    if (this.fiber !== undefined) void Effect.runFork(Fiber.interrupt(this.fiber))
    this.fiber = undefined
    this.holders.clear()
    if (admitted) this.ended(this, true)
  }

  /** the grace a channel nobody holds waits out before it goes */
  linger(ms: number, done: () => void) {
    this.clearGrace()
    this.grace = setTimeout(done, ms)
  }

  clearGrace() {
    if (this.grace !== undefined) clearTimeout(this.grace)
    this.grace = undefined
  }

  private grace: ReturnType<typeof setTimeout> | undefined
}

export class LiveChannels {
  private readonly channels = new Map<string, Channel>()
  private readonly options: ChannelOptions
  private readonly base: () => string
  private readonly clientIdentity: ClientIdentity | undefined
  private identity: string | undefined
  private detach: (() => void) | undefined

  constructor(options: LiveChannelsOptions = {}) {
    this.options = {
      webSocket: options.webSocket ?? globalWebSocket,
      onSessionLost: options.onSessionLost ?? (() => undefined),
      onClientUnsupported: options.onClientUnsupported ?? (() => undefined),
      now: options.now ?? Date.now,
      random: options.random ?? Math.random,
      timing: { ...TIMING, ...options.timing },
    }
    this.base = options.base ?? (() => globalThis.location.href)
    this.clientIdentity = options.clientIdentity
  }

  /** the socket address of an api path, with who the page is in its query */
  private urlOf(path: string): string {
    const url = new URL(path, this.base())
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.hash = ''
    if (this.clientIdentity !== undefined) {
      url.searchParams.set(LIVE_PROTOCOL_PARAM, String(this.clientIdentity.clientProtocol))
      url.searchParams.set(LIVE_RELEASE_PARAM, this.clientIdentity.releaseId)
    }
    return url.href
  }

  /**
   * Hold the channel at an api path for an identity. The release lets go
   * once, however many times it is called.
   */
  hold(identity: string, path: string, holder: LiveHolder): () => void {
    this.retain(identity)
    const key = `${identity}\u0000${path}`
    let channel = this.channels.get(key)
    if (channel === undefined || channel.disposed) {
      channel = new Channel(this.urlOf(path), this.options, (ended, admitted) =>
        this.freed(ended, admitted),
      )
      this.channels.set(key, channel)
      this.attach()
      channel.holders.add(holder)
      channel.dial()
    } else {
      channel.clearGrace()
      channel.holders.add(holder)
    }
    holder.onState(channel.state)
    const held = channel
    let released = false
    return () => {
      if (released) return
      released = true
      held.holders.delete(holder)
      if (held.holders.size > 0 || held.disposed) return
      held.linger(this.options.timing.grace, () => {
        if (held.holders.size > 0) return
        this.drop(key, held)
      })
    }
  }

  /**
   * Let go at once of every channel another identity holds. Called before
   * anything is held under a new identity, and by the runtime the moment the
   * page signs out, so no connection of the last person's waits out a grace.
   */
  retain(identity: string) {
    if (this.identity === identity) return
    this.identity = identity
    for (const [key, channel] of this.channels) {
      if (!key.startsWith(`${identity}\u0000`)) this.drop(key, channel)
    }
  }

  /** every channel this tab keeps, for whoever tests it */
  size(): number {
    return this.channels.size
  }

  /** let go of everything: the runtime is going away */
  dispose() {
    for (const [key, channel] of this.channels) this.drop(key, channel)
    this.detach?.()
    this.detach = undefined
  }

  private drop(key: string, channel: Channel) {
    channel.clearGrace()
    channel.dispose()
    if (this.channels.get(key) === channel) this.channels.delete(key)
    if (this.channels.size === 0) {
      this.detach?.()
      this.detach = undefined
    }
  }

  /**
   * A connection the server had admitted has ended, so a seat may have come
   * free: the longest-waiting channel of this tab asks for it a moment later
   * instead of at the end of its wait. Other tabs find it on their own.
   */
  private freed(ended: Channel, admitted: boolean) {
    if (!admitted) return
    for (const channel of this.channels.values()) {
      if (channel !== ended && channel.waitingFor === 'seat') {
        channel.nudge('seat')
        return
      }
    }
  }

  /** the network and the tab coming back, heard once for every channel */
  private attach() {
    if (this.detach !== undefined || typeof window === 'undefined') return
    const online = () => {
      for (const channel of this.channels.values()) channel.nudge('network')
    }
    const visible = () => {
      if (document.visibilityState !== 'visible') return
      for (const channel of this.channels.values()) channel.check()
    }
    window.addEventListener('online', online)
    window.addEventListener('pageshow', visible)
    document.addEventListener('visibilitychange', visible)
    this.detach = () => {
      window.removeEventListener('online', online)
      window.removeEventListener('pageshow', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }
}
