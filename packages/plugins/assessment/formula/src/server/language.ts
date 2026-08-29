/**
 * The scoped face of one formula language session. A route never touches
 * the sandbox transport: no RpcClient, no sandbox sessionId, no SendLsp
 * sequence - those are Qualy Server ↔ authoring-sandbox concerns. What a
 * route gets is a session whose lifetime is its Scope: send a json-rpc
 * string in, read the ordered event stream out, and the finalizer closes
 * the sandbox session (which F1 guarantees ends in a dead process and a
 * removed workspace).
 *
 * A sibling of FormulaAuthoring on purpose: compile is a one-shot
 * pipeline, a language session is a long-lived resource, and their
 * failure models share nothing but the transport edge (tameTransport).
 */

import { Context, Data, Effect, Layer, Predicate, Stream, type Scope } from 'effect'
import { NodeSocket } from '@effect/platform-node'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import {
  FormulaAuthoringRpcs,
  SANDBOX_RPC_MAX_FRAME_BYTES,
  type LspSendError,
} from '@qualy/sandbox-rpc'
import { authoringSocketPath } from './authoring.ts'
import { tameTransport } from './transport.ts'

/** the authoring process has no room for another session right now */
export class FormulaLanguageBusy extends Data.TaggedError('FormulaLanguageBusy') {}

/** the authoring process cannot be reached, or died under the session */
export class FormulaLanguageUnavailable extends Data.TaggedError('FormulaLanguageUnavailable') {}

/** the frame violated the language protocol; the reason is a stable word */
export class FormulaLanguageRefused extends Data.TaggedError('FormulaLanguageRefused')<{
  readonly reason: string
}> {}

export type FormulaLanguageSendError = FormulaLanguageRefused | FormulaLanguageUnavailable

export interface FormulaLanguageSession {
  readonly send: (jsonRpc: string) => Effect.Effect<void, FormulaLanguageSendError>
  readonly events: Stream.Stream<string, FormulaLanguageUnavailable>
}

export class FormulaLanguage extends Context.Service<
  FormulaLanguage,
  {
    readonly open: (
      source: string,
    ) => Effect.Effect<
      FormulaLanguageSession,
      FormulaLanguageBusy | FormulaLanguageUnavailable,
      Scope.Scope
    >
  }
>()('@qualy/plugin-assessment-formula/FormulaLanguage') {}


const unavailable = () => new FormulaLanguageUnavailable()

const refusalOf = (failure: LspSendError): FormulaLanguageSendError => {
  switch (failure._tag) {
    case 'LspSessionNotFound':
      return new FormulaLanguageUnavailable()
    case 'LspSequenceRejected':
      // the bridge serializes sends; the sandbox seeing otherwise means the
      // session is past reasoning about
      return new FormulaLanguageUnavailable()
    case 'LspFrameTooLarge':
      return new FormulaLanguageRefused({ reason: 'frame-too-large' })
    case 'LspSourceTooLarge':
      return new FormulaLanguageRefused({ reason: 'source-too-large' })
    case 'LspMethodRefused':
      return new FormulaLanguageRefused({ reason: 'method-refused' })
    case 'LspUriRefused':
      return new FormulaLanguageRefused({ reason: 'uri-refused' })
    case 'LspMalformedFrame':
      return new FormulaLanguageRefused({ reason: 'malformed' })
  }
}

export const formulaLanguageLayer = (options?: {
  readonly socketPath?: string
}): Layer.Layer<FormulaLanguage> =>
  Layer.effect(
    FormulaLanguage,
    Effect.gen(function* () {
      const client = yield* RpcClient.make(FormulaAuthoringRpcs)
      const open = (source: string) =>
        Effect.gen(function* () {
          const opened = yield* client.OpenLsp({ initialSource: source }).pipe(
            Effect.catchTags({
              LspBusy: () => Effect.fail(new FormulaLanguageBusy()),
              // the source came from the persisted draft, which is already
              // held to the same ceiling; reaching it is an outage-grade
              // inconsistency, not a caller mistake
              LspSourceTooLarge: () => Effect.fail(new FormulaLanguageUnavailable()),
              RpcClientError: () => Effect.fail(new FormulaLanguageUnavailable()),
            }),
            tameTransport(unavailable),
          )
          yield* Effect.addFinalizer(() =>
            client.CloseLsp({ sessionId: opened.sessionId }).pipe(
              tameTransport(unavailable),
              Effect.ignore,
            ),
          )
          // sends are serialized by the bridge's single consumer; the
          // counter itself bumps in the synchronous prefix regardless
          let sequence = 0
          const send = (jsonRpc: string): Effect.Effect<void, FormulaLanguageSendError> =>
            Effect.suspend(() => {
              sequence += 1
              return client
                .SendLsp({ sessionId: opened.sessionId, sequence, jsonRpc })
                .pipe(
                  Effect.catch((failure) =>
                    Predicate.isTagged(failure, 'RpcClientError')
                      ? Effect.fail(new FormulaLanguageUnavailable())
                      : Effect.fail(refusalOf(failure as LspSendError)),
                  ),
                  tameTransport(unavailable),
                )
            })
          const events: Stream.Stream<string, FormulaLanguageUnavailable> = client
            .LspEvents({ sessionId: opened.sessionId })
            .pipe(
              Stream.map((event) => event.jsonRpc),
              Stream.mapError(() => new FormulaLanguageUnavailable()),
            )
          return { send, events } satisfies FormulaLanguageSession
        })
      return { open }
    }),
  ).pipe(
    Layer.provide(RpcClient.layerProtocolSocket()),
    // layerNet's signature carries SocketError, but building it only wraps
    // a lazy open: boot stays independent of the sandbox being up
    Layer.provide(
      NodeSocket.layerNet({ path: options?.socketPath ?? authoringSocketPath() }).pipe(
        Layer.orDie,
      ),
    ),
    Layer.provide(
      RpcSerialization.layerNdjsonWith({ maxBufferSize: SANDBOX_RPC_MAX_FRAME_BYTES }),
    ),
  )

