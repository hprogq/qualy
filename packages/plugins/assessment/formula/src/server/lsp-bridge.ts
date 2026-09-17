/**
 * The browser side of a formula language session: one WebSocket, one
 * FormulaLanguage session, one Scope. A browser TEXT frame is one LSP
 * json-rpc message and nothing else - no sandbox sessionId, no sequence,
 * no transport headers ever cross this wire.
 *
 * Inbound is explicitly serialized: `Socket.runRaw`'s handler runs its
 * EFFECT results on a fiber set with no ordering promise (vendored
 * Socket.ts fromWebSocket), so the handler here stays on the synchronous
 * path - classify, offerUnsafe, return void - and ONE consumer fiber
 * drains the bounded queue in arrival order. That order is what becomes
 * the F1 SendLsp sequence.
 *
 * Close codes are the protocol's whole vocabulary outward: 1003 for
 * binary, 1009 for an oversized text frame, 1008 for a policy refusal,
 * 1013 when the browser floods the queue, 1011 when the authoring side
 * dies, 4429 when the person already holds every seat, 1000 for a normal
 * goodbye. Reasons are short stable words - no internal paths, no stacks,
 * no sandbox detail.
 */

import { Cause, Context, Effect, Layer, Queue, Ref, Result, Stream, type Scope } from 'effect'
import { Socket } from 'effect/unstable/socket'
import { LSP_FRAME_LIMIT } from '@qualy/sandbox-rpc'
import type { FormulaLanguageSession } from './language.ts'

/** how many browser frames may wait for the consumer before the deal is off */
const INBOUND_QUEUE_CAPACITY = 64

/**
 * How many live bridges one person may hold at once.
 *
 * More than one: somebody editing two formulas in two windows, or reading a
 * published version beside the draft it came from, needs language
 * assistance in each. Few enough that one person cannot take most of the
 * authoring sandbox's global sessions, which are shared by everybody
 * writing formulas and remain the real resource guard.
 */
export const FORMULA_LSP_SEATS_PER_PERSON = 3

/** the close a browser reads as "you already hold every seat" */
const SEAT_LIMIT_CLOSE = { code: 4429, reason: 'seat-limit' } as const

/**
 * Counted seats per person: keyed by tenant and user, not by the auth
 * session, or one person with several browsers would multiply their share
 * of the sandbox. Layer-owned state on purpose - a module-global Map has no
 * lifecycle and no owner.
 */
export class FormulaLspQuota extends Context.Service<
  FormulaLspQuota,
  {
    /** true when a seat was taken; released with the scope */
    readonly acquire: (key: string) => Effect.Effect<boolean, never, Scope.Scope>
  }
>()('@qualy/plugin-assessment-formula/FormulaLspQuota') {}

export const formulaLspQuotaLayer: Layer.Layer<FormulaLspQuota> = Layer.effect(
  FormulaLspQuota,
  Effect.gen(function* () {
    const seats = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
    const acquire = (key: string): Effect.Effect<boolean, never, Scope.Scope> =>
      Effect.acquireRelease(
        Ref.modify(seats, (held) => {
          const taken = held.get(key) ?? 0
          if (taken >= FORMULA_LSP_SEATS_PER_PERSON) return [false, held] as const
          const next = new Map(held)
          next.set(key, taken + 1)
          return [true, next as ReadonlyMap<string, number>] as const
        }),
        (seated) =>
          seated
            ? Ref.update(seats, (held) => {
                const next = new Map(held)
                const remaining = (held.get(key) ?? 1) - 1
                if (remaining > 0) next.set(key, remaining)
                else next.delete(key)
                return next as ReadonlyMap<string, number>
              })
            : Effect.void,
      )
    return { acquire }
  }),
)

/**
 * Refuse an upgraded socket for want of a seat.
 *
 * A browser's WebSocket cannot read the status of a refused handshake - it
 * sees only a failed connection with close code 1006 - so a refusal it must
 * tell apart from an outage arrives as a completed upgrade closed at once
 * with an application close code. No language session is opened for it.
 */
export const refuseSeat = (socket: Socket.Socket): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    // the transport only exists once the read half is acquired: the upgrade
    // itself happens there, and a write before it waits for it
    yield* socket.reader
    const { write } = yield* socket.writer
    yield* write(new Socket.CloseEvent(SEAT_LIMIT_CLOSE.code, SEAT_LIMIT_CLOSE.reason))
  }).pipe(Effect.ignore)

/** the id of a json-rpc REQUEST, if the frame is one; null otherwise */
const requestIdOf = (jsonRpc: string): number | string | null => {
  try {
    const parsed = JSON.parse(jsonRpc) as { id?: unknown }
    return typeof parsed === 'object' &&
      parsed !== null &&
      (typeof parsed.id === 'number' || typeof parsed.id === 'string')
      ? parsed.id
      : null
  } catch {
    return null
  }
}

type InboundFrame =
  | { readonly kind: 'text'; readonly jsonRpc: string }
  | { readonly kind: 'binary' }
  | { readonly kind: 'oversized' }

/**
 * Pump one upgraded socket against one language session until either side
 * ends. Returns when the connection is over; every resource it forks lives
 * in the surrounding scope.
 */
export const bridgeSocket = (
  socket: Socket.Socket,
  session: FormulaLanguageSession,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const inbound = yield* Queue.bounded<InboundFrame, Cause.Done>(INBOUND_QUEUE_CAPACITY)
    let flooded = false
    // the write half is an object now; `write` off it is the same call
    const { write } = yield* socket.writer

    const closeWith = (code: number, reason: string): Effect.Effect<void> =>
      write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore)

    // the ONE consumer: arrival order in, SendLsp order out
    const consume: Effect.Effect<void> = Effect.gen(function* () {
      for (;;) {
        const frame = yield* Queue.take(inbound)
        switch (frame.kind) {
          case 'binary':
            return yield* closeWith(1003, 'text frames only')
          case 'oversized':
            return yield* closeWith(1009, 'frame too large')
          case 'text': {
            const sent = yield* Effect.result(session.send(frame.jsonRpc))
            if (Result.isFailure(sent)) {
              // a method outside the sandbox's allowlist is a version drift
              // (an older sandbox behind a newer browser), not an attack: a
              // REQUEST gets the standard json-rpc answer and the
              // conversation continues; every other refusal still ends it
              if (
                sent.failure._tag === 'FormulaLanguageRefused' &&
                sent.failure.reason === 'method-refused'
              ) {
                const requestId = requestIdOf(frame.jsonRpc)
                if (requestId !== null)
                  yield* write(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      id: requestId,
                      error: { code: -32601, message: 'method not available' },
                    }),
                  ).pipe(Effect.ignore)
                continue
              }
              return yield* sent.failure._tag === 'FormulaLanguageRefused'
                ? closeWith(1008, sent.failure.reason)
                : closeWith(1011, 'language service unavailable')
            }
          }
        }
      }
    }).pipe(
      // Done from the queue: either the socket loop ended first (nothing to
      // say) or the browser flooded the bounded queue (say so and close)
      Effect.catch(() => (flooded ? closeWith(1013, 'inbound queue overflow') : Effect.void)),
    )
    yield* consume.pipe(Effect.forkScoped)

    // the ONE outbound channel: ordered events, one writer, no per-event fibers
    yield* session.events.pipe(
      Stream.runForEach((jsonRpc) => write(jsonRpc)),
      Effect.catch(() => closeWith(1011, 'language service unavailable')),
      Effect.forkScoped,
    )

    // The socket loop is the connection's spine.
    //
    // It used to be a synchronous callback handed to `runRaw`, kept
    // synchronous so arrival order survived - effect results run on an
    // unordered fiber set. The read half is a pull now, and one fiber
    // draining it in a loop gives that ordering by construction: a batch
    // arrives in arrival order, and the next pull does not start until this
    // one is classified. So the classification stays unsuspended, and the
    // offer stays the unsafe one, for the reason it always was.
    //
    // The transport applies its own backpressure now (it pauses past its
    // high-water mark), but the bounded queue below still guards the half
    // this loop cannot see: a language session that has stopped consuming.
    // This loop keeps pulling regardless, so that flood is still reachable,
    // and the answer to it is still to end the connection rather than let
    // the buffer grow.
    yield* Effect.gen(function* () {
      const { pull } = yield* socket.reader
      for (;;) {
        for (const data of yield* pull) {
          const frame: InboundFrame =
            typeof data !== 'string'
              ? { kind: 'binary' }
              : Buffer.byteLength(data, 'utf8') > LSP_FRAME_LIMIT
                ? { kind: 'oversized' }
                : { kind: 'text', jsonRpc: data }
          if (!Queue.offerUnsafe(inbound, frame)) {
            // a consumer this far behind is a flood; the connection ends
            // rather than the buffer growing
            flooded = true
            Queue.endUnsafe(inbound)
          }
        }
      }
    }).pipe(
      // any socket-side ending (client close, network error) lands here;
      // the scope's finalizers do the rest
      Effect.ignore,
    )
  })
