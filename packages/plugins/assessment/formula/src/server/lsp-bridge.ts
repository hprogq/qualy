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
 * dies, 1000 for a normal goodbye. Reasons are short stable words - no
 * internal paths, no stacks, no sandbox detail.
 */

import { Cause, Context, Effect, Layer, Queue, Ref, Result, Stream, type Scope } from 'effect'
import { Socket } from 'effect/unstable/socket'
import { LSP_FRAME_LIMIT } from '@qualy/sandbox-rpc'
import type { FormulaLanguageSession } from './language.ts'

/** how many browser frames may wait for the consumer before the deal is off */
const INBOUND_QUEUE_CAPACITY = 64

/**
 * One live bridge per person: keyed by tenant and user, not by the auth
 * session, or one person with two browsers would hold two language
 * servers. Layer-owned state on purpose - a module-global Set has no
 * lifecycle and no owner.
 */
export class FormulaLspQuota extends Context.Service<
  FormulaLspQuota,
  {
    /** true when the slot was taken; released with the scope */
    readonly acquire: (key: string) => Effect.Effect<boolean, never, Scope.Scope>
  }
>()('@qualy/plugin-assessment-formula/FormulaLspQuota') {}

export const formulaLspQuotaLayer: Layer.Layer<FormulaLspQuota> = Layer.effect(
  FormulaLspQuota,
  Effect.gen(function* () {
    const holders = yield* Ref.make<ReadonlySet<string>>(new Set())
    const acquire = (key: string): Effect.Effect<boolean, never, Scope.Scope> =>
      Effect.acquireRelease(
        Ref.modify(holders, (held) => {
          if (held.has(key)) return [false, held] as const
          const next = new Set(held)
          next.add(key)
          return [true, next as ReadonlySet<string>] as const
        }),
        (taken) =>
          taken
            ? Ref.update(holders, (held) => {
                const next = new Set(held)
                next.delete(key)
                return next as ReadonlySet<string>
              })
            : Effect.void,
      )
    return { acquire }
  }),
)

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
    const write = yield* socket.writer

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

    // the socket loop is the connection's spine; the handler stays on the
    // SYNCHRONOUS path so arrival order survives (measured: effect results
    // are run on an unordered fiber set)
    yield* socket
      .runRaw((data) => {
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
      })
      .pipe(
        // any socket-side ending (client close, network error) lands here;
        // the scope's finalizers do the rest
        Effect.ignore,
      )
  })
