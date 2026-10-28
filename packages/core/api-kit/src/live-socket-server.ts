import { Clock, Duration, Effect, Random, Stream, type Scope } from 'effect'
import { HttpServerRequest } from 'effect/http'
import { Socket } from 'effect/socket'
import {
  LIVE_CLOSE,
  LIVE_HEARTBEAT_MS,
  LIVE_INBOUND_FRAME_LIMIT,
  LIVE_PONG,
  LIVE_PROTOCOL_PARAM,
  LIVE_RELEASE_PARAM,
  LIVE_SILENCE_MS,
  LIVE_SUBPROTOCOL,
} from './live-socket.ts'

// The serving half of a live channel (see ./live-socket.ts), over effect's
// own Socket: one upgraded connection, the wake-ups a caller hands it, and
// every rule that keeps such a connection honest.
//
// The caller decides who may listen and to what; this decides how the
// connection lives. It says it is there every heartbeat and expects the page
// to answer each, so a page that went to sleep or off the network is let go
// within a minute rather than held until TCP notices. It takes nothing from
// the page but those answers - anything else is the end of the connection -
// and it ends every connection once its lifetime is up, so whoever listens
// is judged afresh on the next dial. A caller's recheck may end it sooner.
//
// What it cannot see is the socket's send buffer: effect's Socket writes
// without exposing it. A page that stops reading is found by the silence
// instead - it stops answering too - and until then what queues for it is
// the wake-ups of one minute, a few dozen bytes each.

/** how a connection ended, for the caller's log line and its metrics */
export type LiveEnding =
  /** the server closed it, with this code */
  | { readonly by: 'server'; readonly code: number; readonly reason: string }
  /** the page closed it or the connection dropped; 1006 when nothing was said */
  | { readonly by: 'client'; readonly code: number }

/** the end a recheck asks for: a close code and its reason */
export interface LiveRefusal {
  readonly code: number
  readonly reason: string
}

export interface LiveSocketOptions<A> {
  /**
   * The wake-ups, already filtered for whoever listens. Subscribed before
   * the first word is written, so nothing announced after `sync` is lost.
   */
  readonly messages: Stream.Stream<A>
  /** the catch-up word every connection opens with */
  readonly sync: A
  /** how long the connection lives before it is renewed */
  readonly lifetime: Duration.Input
  /**
   * Asked every `every`: is the listener still entitled to listen? A refusal
   * closes the connection with it; anything that fails is answered as not
   * entitled, never as yes.
   */
  readonly recheck?: {
    readonly every: Duration.Input
    readonly check: Effect.Effect<LiveRefusal | undefined>
  }
  /** for tests: how often to say hello, and how long a silence is fatal */
  readonly heartbeatMs?: number
  readonly silenceMs?: number
}

const encode = (message: unknown): string => JSON.stringify(message)

/** the page's declared generation and release, as the query carries them */
export const liveClientOf = (
  request: HttpServerRequest.HttpServerRequest,
): { readonly protocol: string | undefined; readonly release: string | undefined } => {
  const url = new URL(request.url, 'http://live.invalid')
  const one = (name: string) => {
    const all = url.searchParams.getAll(name)
    return all.length === 1 ? all[0] : all.length === 0 ? undefined : ''
  }
  return { protocol: one(LIVE_PROTOCOL_PARAM), release: one(LIVE_RELEASE_PARAM) }
}

/** whether the handshake offered this channel's subprotocol */
export const offersLiveSubprotocol = (request: HttpServerRequest.HttpServerRequest): boolean =>
  (request.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .some((offered) => offered.trim() === LIVE_SUBPROTOCOL)

/**
 * Complete the handshake and close at once with a refusal.
 *
 * The only refusal a browser can read: a refused handshake is a failed
 * connection, the same thing an outage looks like.
 */
export const refuseLiveSocket = (
  socket: Socket.Socket,
  refusal: LiveRefusal,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    // the transport only exists once the read half is acquired: the upgrade
    // itself happens there, and a write before it waits for it
    yield* socket.reader
    const { write } = yield* socket.writer
    yield* write(new Socket.CloseEvent(refusal.code, refusal.reason))
  }).pipe(Effect.ignore)

/** the code a dropped or closed connection said, 1006 when it said nothing */
const remoteCodeOf = (error: Socket.SocketError): number =>
  error.reason._tag === 'SocketCloseError' ? error.reason.code : 1006

/**
 * Serve one upgraded connection until it ends, and say how it ended. Every
 * fiber it forks lives in the surrounding scope.
 */
export const serveLiveSocket = <A>(
  socket: Socket.Socket,
  options: LiveSocketOptions<A>,
): Effect.Effect<LiveEnding, never, Scope.Scope> =>
  Effect.gen(function* () {
    const heartbeatMs = options.heartbeatMs ?? LIVE_HEARTBEAT_MS
    const silenceMs = options.silenceMs ?? LIVE_SILENCE_MS
    const opened = yield* Effect.result(socket.reader)
    if (opened._tag === 'Failure') {
      return { by: 'client', code: remoteCodeOf(opened.failure) } satisfies LiveEnding
    }
    const { pull } = opened.success
    const { write } = yield* socket.writer
    let heardAt = yield* Clock.currentTimeMillis

    const server = (code: number, reason: string): LiveEnding => ({ by: 'server', code, reason })

    // the page's half: answers, and nothing else
    const inbound: Effect.Effect<LiveEnding> = Effect.gen(function* () {
      for (;;) {
        const frames = yield* pull
        for (const frame of frames) {
          if (typeof frame !== 'string') return server(LIVE_CLOSE.unsupportedData, 'text only')
          if (frame.length > LIVE_INBOUND_FRAME_LIMIT) {
            return server(LIVE_CLOSE.tooBig, 'frame too large')
          }
          if (frame !== LIVE_PONG) return server(LIVE_CLOSE.policy, 'unexpected message')
        }
        // a batch is answers that arrived in one tick; more than a few in one
        // heartbeat is no longer answering, it is talking
        if (frames.length > 4) return server(LIVE_CLOSE.policy, 'too many messages')
        heardAt = yield* Clock.currentTimeMillis
      }
    }).pipe(
      Effect.catch((error: Socket.SocketError) =>
        Effect.succeed<LiveEnding>({ by: 'client', code: remoteCodeOf(error) }),
      ),
    )

    // the server's half: catch-up first, then whatever moves
    const outbound: Effect.Effect<LiveEnding> = Effect.gen(function* () {
      yield* write(encode(options.sync))
      yield* options.messages.pipe(Stream.runForEach((message) => write(encode(message))))
      return server(LIVE_CLOSE.normal, 'ended')
    }).pipe(
      Effect.catch((error: Socket.SocketError) =>
        Effect.succeed<LiveEnding>({ by: 'client', code: remoteCodeOf(error) }),
      ),
    )

    const heartbeat: Effect.Effect<LiveEnding> = Effect.gen(function* () {
      for (;;) {
        yield* Effect.sleep(heartbeatMs)
        const now = yield* Clock.currentTimeMillis
        if (now - heardAt > silenceMs) return server(LIVE_CLOSE.unresponsive, 'no answer')
        yield* write(encode({ kind: 'heartbeat' }))
      }
    }).pipe(
      Effect.catch((error: Socket.SocketError) =>
        Effect.succeed<LiveEnding>({ by: 'client', code: remoteCodeOf(error) }),
      ),
    )

    const lifetime: Effect.Effect<LiveEnding> = Effect.as(
      Effect.sleep(options.lifetime),
      server(LIVE_CLOSE.renew, 'renew'),
    )

    const recheck: Effect.Effect<LiveEnding> =
      options.recheck === undefined
        ? Effect.never
        : Effect.gen(function* () {
            const { every, check } = options.recheck!
            for (;;) {
              yield* Effect.sleep(every)
              const refused = yield* check.pipe(
                Effect.catchCause(() =>
                  Effect.succeed<LiveRefusal>({ code: LIVE_CLOSE.internal, reason: 'recheck' }),
                ),
              )
              if (refused !== undefined) return server(refused.code, refused.reason)
            }
          })

    const ending = yield* Effect.raceAll([inbound, outbound, heartbeat, lifetime, recheck])
    if (ending.by === 'server') {
      yield* write(new Socket.CloseEvent(ending.code, ending.reason)).pipe(Effect.ignore)
    }
    return ending
  })

/** a duration spread by up to a fraction either way, so connections made together end apart */
export const spread = (base: Duration.Input, fraction: number): Effect.Effect<Duration.Duration> =>
  Effect.map(Random.next, (draw) =>
    Duration.millis(Math.round(Duration.toMillis(base) * (1 + fraction * (draw * 2 - 1)))),
  )
