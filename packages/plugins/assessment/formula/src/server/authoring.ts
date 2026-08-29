/**
 * The compile service the library speaks to: source in, artifact and
 * frozen identities out, with every refusal already dressed as this
 * plugin's wire errors. Production talks to the authoring sandbox process
 * over its unix socket and nothing else - an unreachable compiler is a 503,
 * never a reason to run tsc in the business process. The in-process
 * implementation lives on the testkit subpath for tests.
 */

import { Cause, Context, Effect, Fiber, Layer, Predicate, Result } from 'effect'
import { NodeSocket } from '@effect/platform-node'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import {
  CompiledFormulaWire,
  FormulaAuthoringRpcs,
  SANDBOX_RPC_MAX_FRAME_BYTES,
  type AuthoringCompileError,
} from '@qualy/sandbox-rpc'
import {
  FormulaBundleFailed,
  FormulaCompileUnavailable,
  FormulaExecutionLimitExceeded,
  FormulaSourceRefused,
  FormulaSourceTooLarge,
  FormulaTypecheckFailed,
} from './errors.ts'

export type AuthoringRefusal =
  | FormulaSourceTooLarge
  | FormulaSourceRefused
  | FormulaTypecheckFailed
  | FormulaExecutionLimitExceeded
  | FormulaBundleFailed
  | FormulaCompileUnavailable

export type CompiledAuthoring = typeof CompiledFormulaWire.Type

export class FormulaAuthoring extends Context.Service<
  FormulaAuthoring,
  {
    readonly compile: (source: string) => Effect.Effect<CompiledAuthoring, AuthoringRefusal>
  }
>()('@qualy/plugin-assessment-formula/FormulaAuthoring') {}

/** the default socket, relative to the working directory in development */
export const authoringSocketPath = (): string =>
  process.env.QUALY_SANDBOX_AUTHORING_SOCKET ?? '.qualy/run/sandbox/authoring/authoring.sock'

/**
 * How long the transport will wait for ANY answer. The pipeline's own
 * budgets live inside the compiler (tsc wall clock, the bounded queue);
 * this only exists so a hung or flapping peer cannot park a publication.
 */
const COMPILE_TRANSPORT_DEADLINE_MS = 90_000

export const fromWire = (failure: AuthoringCompileError): AuthoringRefusal => {
  switch (failure._tag) {
    case 'CompileSourceTooLarge':
      return new FormulaSourceTooLarge({ limit: failure.limit })
    case 'CompileSourceRefused': {
      const finding = failure.findings[0] ?? { reason: 'import' as const }
      return new FormulaSourceRefused({
        reason: finding.reason,
        ...(finding.specifier === undefined ? {} : { specifier: finding.specifier }),
      })
    }
    case 'CompileTypecheckTimeout':
      return new FormulaExecutionLimitExceeded({ phase: 'typecheck', verdict: 'wall-clock' })
    case 'CompileTypecheckFailed':
      return new FormulaTypecheckFailed({
        diagnostics: failure.diagnostics,
        truncated: failure.truncated,
      })
    case 'CompileBundleFailed':
      return new FormulaBundleFailed({ message: failure.message })
    case 'CompileBusy':
      return new FormulaCompileUnavailable()
  }
}

const deadline = <A, E>(call: Effect.Effect<A, E>, refuse: () => E): Effect.Effect<A, E> =>
  Effect.withFiber((parent) => {
    // detached, exactly like the runtime adapter: a call stuck in a write
    // against a flapping connection cannot be interrupted, so awaiting the
    // fiber - always interruptible - is what the deadline races
    const fiber = Effect.runForkWith(parent.context as Context.Context<never>)(call)
    const abandon = Effect.sync(() => fiber.interruptUnsafe(parent.id))
    return Effect.gen(function* () {
      const settled = yield* Effect.raceFirst(
        Fiber.await(fiber),
        Effect.sleep(COMPILE_TRANSPORT_DEADLINE_MS).pipe(Effect.as(undefined)),
      )
      if (settled === undefined) {
        yield* abandon
        return yield* Effect.fail(refuse())
      }
      return yield* settled
    }).pipe(Effect.onInterrupt(() => abandon))
  })

export const formulaAuthoringLayer = (options?: {
  readonly socketPath?: string
}): Layer.Layer<FormulaAuthoring> =>
  Layer.effect(
    FormulaAuthoring,
    Effect.gen(function* () {
      const client = yield* RpcClient.make(FormulaAuthoringRpcs)
      const compile = (source: string): Effect.Effect<CompiledAuthoring, AuthoringRefusal> =>
        deadline(
          client.CompileFormula({ source }).pipe(
            Effect.catchTag('RpcClientError', () => Effect.fail(new FormulaCompileUnavailable())),
            Effect.catch((failure) =>
              failure instanceof FormulaCompileUnavailable
                ? Effect.fail(failure)
                : Effect.fail(fromWire(failure)),
            ),
            // a mid-call socket failure arrives as a deliberate upstream
            // defect (RpcClient send is orDie); tame exactly that into the
            // 503 and let real defects fly
            Effect.catchCause((cause) => {
              if (Result.isSuccess(Cause.findError(cause))) return Effect.failCause(cause)
              return Predicate.isTagged(Cause.squash(cause), 'SocketError')
                ? Effect.fail(new FormulaCompileUnavailable())
                : Effect.failCause(cause)
            }),
          ),
          () => new FormulaCompileUnavailable(),
        )
      return { compile }
    }),
  ).pipe(
    Layer.provide(RpcClient.layerProtocolSocket()),
    // layerNet's signature carries SocketError, but building it only wraps
    // a lazy open: boot stays independent of the sandbox being up
    Layer.provide(
      NodeSocket.layerNet({ path: options?.socketPath ?? authoringSocketPath() }).pipe(Layer.orDie),
    ),
    Layer.provide(RpcSerialization.layerNdjsonWith({ maxBufferSize: SANDBOX_RPC_MAX_FRAME_BYTES })),
  )
