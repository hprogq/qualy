/**
 * The sandbox service: resource-limited, deterministic execution of a
 * self-contained artifact. Business-blind on purpose — no tenant, no item,
 * no version ids; the caller knows its context, this service only knows how
 * to run code safely.
 *
 * Production runs the REMOTE adapter and nothing else: guest code executes
 * in the runtime sandbox process behind a unix socket, and this layer only
 * speaks the RPC contract. There is no local fallback — an unreachable
 * runtime is SandboxUnavailable, an outage the caller reports. The client
 * still refuses what it can before paying a round trip (limits, sizes, the
 * artifact hash), and the runtime refuses again on its own side, because a
 * socket peer is nobody's friend.
 */

import { createHash } from 'node:crypto'
import { Cause, Context, Effect, Fiber, Layer, Predicate, Result } from 'effect'
import { NodeSocket } from '@effect/platform-node'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import {
  DEFAULT_LIMITS,
  ENTRYPOINT,
  RPC_API_VERSION,
  RuntimeCapabilities,
  RuntimeSandboxRpcs,
  SANDBOX_ABI_VERSION,
  SANDBOX_RPC_ENVELOPE_BUDGET,
  SANDBOX_RPC_MAX_FRAME_BYTES,
  limitIssue,
  type JsonValue,
  type RuntimeSandboxError,
  type SandboxLimits,
} from '@qualy/sandbox-rpc'
import {
  SandboxArtifactMismatch,
  SandboxArtifactTooLarge,
  SandboxEvalFailed,
  SandboxInputTooLarge,
  SandboxMemoryExceeded,
  SandboxOutputTooLarge,
  SandboxStackExceeded,
  SandboxTimeout,
  SandboxUnavailable,
  SandboxWorkerLost,
  type SandboxError,
} from './errors.ts'

export { SANDBOX_ABI_VERSION }

export interface SandboxInvocation {
  /** the complete, self-contained program; nothing else will be resolvable */
  readonly artifact: string
  /** sha-256 hex of the artifact; refused when it does not match */
  readonly artifactHash: string
  /** a global identifier the artifact defined */
  readonly entrypoint: string
  readonly arguments: readonly JsonValue[]
  readonly limits?: Partial<SandboxLimits>
}

export class Sandbox extends Context.Service<
  Sandbox,
  {
    readonly invoke: (invocation: SandboxInvocation) => Effect.Effect<string, SandboxError>
    /** the engine's identity, for callers that freeze toolchains into records */
    readonly engine: Effect.Effect<string, SandboxError>
    /** the serving implementation's digest; provenance only, never compat */
    readonly runtimeBuildId: Effect.Effect<string, SandboxError>
  }
>()('@qualy/plugin-sandbox/Sandbox') {}

export const sha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

export const refuseOversize = (
  invocation: SandboxInvocation,
  limits: SandboxLimits,
): SandboxError | undefined => {
  const artifactBytes = Buffer.byteLength(invocation.artifact, 'utf8')
  if (artifactBytes > limits.artifactBytes)
    return new SandboxArtifactTooLarge({ bytes: artifactBytes, limit: limits.artifactBytes })
  const inputBytes = Buffer.byteLength(JSON.stringify(invocation.arguments), 'utf8')
  if (inputBytes > limits.inputBytes)
    return new SandboxInputTooLarge({ bytes: inputBytes, limit: limits.inputBytes })
  return undefined
}

/**
 * How long past the caller's own hard deadline the transport will wait for
 * ANY answer before declaring the runtime unavailable. Workload timing
 * belongs to the limits; this only exists so a hung or flapping peer cannot
 * park a caller forever.
 */
const TRANSPORT_GRACE_MS = 15_000

/** the default socket, relative to the working directory in development */
export const runtimeSocketPath = (): string =>
  process.env.QUALY_SANDBOX_RUNTIME_SOCKET ?? '.qualy/run/sandbox/runtime/runtime.sock'

const transportDeadline = (
  call: Effect.Effect<string, SandboxError>,
  deadlineMs: number,
): Effect.Effect<string, SandboxError> =>
  Effect.withFiber((parent) => {
    // a DETACHED fiber on purpose: a child would be awaited by its parent on
    // completion, and this call can be stuck in a write that waits
    // uninterruptibly for a flapping connection (measured with a
    // slam-the-door peer) - the deadline must not inherit that fate. The
    // stuck fiber gets a fire-and-forget interrupt and dies with the
    // connection's scope at the latest.
    const fiber = Effect.runForkWith(parent.context as Context.Context<never>)(call)
    const abandon = Effect.sync(() => fiber.interruptUnsafe(parent.id))
    return Effect.gen(function* () {
      const settled = yield* Effect.raceFirst(
        Fiber.await(fiber),
        Effect.sleep(deadlineMs).pipe(Effect.as(undefined)),
      )
      if (settled === undefined) {
        yield* abandon
        return yield* Effect.fail(
          new SandboxUnavailable({
            reason: 'the runtime did not answer within the transport deadline',
          }),
        )
      }
      return yield* settled
    }).pipe(Effect.onInterrupt(() => abandon))
  })

const fromWire = (failure: RuntimeSandboxError): Effect.Effect<never, SandboxError> => {
  switch (failure._tag) {
    case 'SandboxTimeout':
      return Effect.fail(new SandboxTimeout({ phase: failure.phase }))
    case 'SandboxMemoryExceeded':
      return Effect.fail(new SandboxMemoryExceeded())
    case 'SandboxStackExceeded':
      return Effect.fail(new SandboxStackExceeded())
    case 'SandboxOutputTooLarge':
      return Effect.fail(new SandboxOutputTooLarge())
    case 'SandboxArtifactTooLarge':
      return Effect.fail(
        new SandboxArtifactTooLarge({ bytes: failure.bytes, limit: failure.limit }),
      )
    case 'SandboxInputTooLarge':
      return Effect.fail(new SandboxInputTooLarge({ bytes: failure.bytes, limit: failure.limit }))
    case 'SandboxArtifactMismatch':
      return Effect.fail(
        new SandboxArtifactMismatch({ expected: failure.expected, actual: failure.actual }),
      )
    case 'SandboxLimitsRefused':
      // the client checked the same rule before sending; the runtime seeing
      // otherwise means a defective caller, same as the local semantics
      return Effect.die(new Error(`sandbox limits: ${failure.issue}`))
    case 'SandboxEvalFailed':
      return Effect.fail(new SandboxEvalFailed({ name: failure.name, message: failure.message }))
    case 'SandboxWorkerLost':
      return Effect.fail(new SandboxWorkerLost({ reason: failure.reason }))
  }
}

export const sandboxLayer = (options?: { readonly socketPath?: string }): Layer.Layer<Sandbox> =>
  Layer.effect(
    Sandbox,
    Effect.gen(function* () {
      const client = yield* RpcClient.make(RuntimeSandboxRpcs)

      // capabilities are fetched lazily and once: boot must not depend on the
      // sandbox being up (its absence is an outage at USE time), and the
      // protocol versions are asserted before anything else is believed
      let known: typeof RuntimeCapabilities.Type | undefined
      const capabilities: Effect.Effect<typeof RuntimeCapabilities.Type, SandboxError> =
        Effect.suspend(() => {
          if (known !== undefined) return Effect.succeed(known)
          return client.GetRuntimeCapabilities().pipe(
            Effect.mapError(
              (failure) =>
                new SandboxUnavailable({ reason: `runtime unreachable: ${failure.reason._tag}` }),
            ),
            Effect.flatMap((reported) => {
              if (
                reported.rpcApiVersion !== RPC_API_VERSION ||
                reported.sandboxAbiVersion !== SANDBOX_ABI_VERSION
              )
                return Effect.fail(
                  new SandboxUnavailable({
                    reason: `protocol mismatch: runtime speaks rpc ${reported.rpcApiVersion} / abi ${reported.sandboxAbiVersion}, this host speaks rpc ${RPC_API_VERSION} / abi ${SANDBOX_ABI_VERSION}`,
                  }),
                )
              known = reported
              return Effect.succeed(reported)
            }),
          )
        })

      const invoke = (invocation: SandboxInvocation): Effect.Effect<string, SandboxError> => {
        const limits: SandboxLimits = { ...DEFAULT_LIMITS, ...invocation.limits }
        // an infra service keeps its own invariants: a caller passing a
        // nonsensical limit is a defect in the caller, not a soft failure
        const wrong = limitIssue(limits)
        if (wrong !== undefined) return Effect.die(new Error(`sandbox limits: ${wrong}`))
        if (!ENTRYPOINT.test(invocation.entrypoint))
          return Effect.fail(
            new SandboxEvalFailed({
              name: 'TypeError',
              message: 'entrypoint is not an identifier',
            }),
          )
        const oversize = refuseOversize(invocation, limits)
        if (oversize !== undefined) return Effect.fail(oversize)
        const actual = sha256(invocation.artifact)
        if (actual !== invocation.artifactHash)
          return Effect.fail(
            new SandboxArtifactMismatch({ expected: invocation.artifactHash, actual }),
          )
        const request = {
          artifact: invocation.artifact,
          artifactSha256: invocation.artifactHash,
          entrypoint: invocation.entrypoint,
          argumentsJson: JSON.stringify(invocation.arguments),
          limits,
        }
        // the size gates above measure content bytes; a hostile escaping
        // density (control characters json-escape at 6x) could still blow
        // the transport frame, and an oversized frame closes the CONNECTION
        // under every in-flight request. Measure the encoded request and
        // refuse here, so a pathological artifact never reaches the socket.
        const encodedBytes = Buffer.byteLength(JSON.stringify(request), 'utf8')
        if (encodedBytes > SANDBOX_RPC_ENVELOPE_BUDGET)
          return Effect.fail(
            new SandboxArtifactTooLarge({
              bytes: encodedBytes,
              limit: SANDBOX_RPC_ENVELOPE_BUDGET,
            }),
          )
        return client.Invoke(request).pipe(
          Effect.map((answer) => answer.output),
          Effect.catchTag('RpcClientError', (failure) =>
            Effect.fail(
              new SandboxUnavailable({ reason: `runtime unreachable: ${failure.reason._tag}` }),
            ),
          ),
          Effect.catch((failure) =>
            failure instanceof SandboxUnavailable ? Effect.fail(failure) : fromWire(failure),
          ),
          // the protocol turns a mid-call socket failure into a DEFECT on
          // purpose (vendored RpcClient.ts:1156 `Effect.orDie(write(...))`);
          // on this side of the boundary that is not a bug in anybody's
          // code, it is the runtime being unreachable - tame exactly that
          // defect back into the typed outage and let real defects fly.
          Effect.catchCause((cause) => {
            if (Result.isSuccess(Cause.findError(cause))) return Effect.failCause(cause)
            return Predicate.isTagged(Cause.squash(cause), 'SocketError')
              ? Effect.fail(new SandboxUnavailable({ reason: 'the connection failed mid-call' }))
              : Effect.failCause(cause)
          }),
          // the transport's own deadline: a peer that accepts and stalls -
          // or flaps so fast a write never lands (measured with a
          // slam-the-door peer) - must not hang the caller past the work's
          // own budget. Generous on purpose: the ENGINE's watchdog owns
          // real timing, this only catches a protocol that never answers.
          // Not race/timeoutOrElse/raceFirst: every one of those waits on
          // interrupting the loser, and the call can be stuck in a write
          // that waits uninterruptibly for a flapping connection (measured
          // with a slam-the-door peer). So the call runs in its own fiber:
          // awaiting THAT is always interruptible, and past the deadline
          // the stuck fiber gets a fire-and-forget interrupt while the
          // caller leaves with a typed outage.
          (call) => transportDeadline(call, limits.hardDeadlineMs + TRANSPORT_GRACE_MS),
        )
      }
      return {
        invoke,
        engine: Effect.map(capabilities, (c) => c.quickjsEngineVersion),
        runtimeBuildId: Effect.map(capabilities, (c) => c.runtimeBuildId),
      }
    }),
  ).pipe(
    Layer.provide(RpcClient.layerProtocolSocket()),
    // layerNet's signature carries SocketError, but its make only wraps a
    // lazy open (vendored NodeSocket.ts:59-99): building the layer cannot
    // actually fail, so orDie converts the phantom channel and boot stays
    // independent of the sandbox being up
    Layer.provide(
      NodeSocket.layerNet({ path: options?.socketPath ?? runtimeSocketPath() }).pipe(Layer.orDie),
    ),
    Layer.provide(RpcSerialization.layerNdjsonWith({ maxBufferSize: SANDBOX_RPC_MAX_FRAME_BYTES })),
  )

export const serviceLayer: Layer.Layer<Sandbox> = sandboxLayer()
