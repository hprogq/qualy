import { Cause, Effect, Exit, Option } from 'effect'
import { DURATION_BOUNDARIES, boundedDurationHistogram } from '@qualy/telemetry/metrics'
import type { RuntimeTimings } from '@qualy/sandbox-rpc'
import type { SandboxError } from './errors.ts'
import type { SandboxAnswer } from './service.ts'

// How long a sandbox call takes, seen from the caller, and how it ended. The
// sandbox itself has no network to report from, so the client says it. One
// label, a closed set: formulas, tenants and artifacts stay out.

const OUTCOMES = [
  'completed',
  // the engine interrupted a program that was still running
  'soft-timeout',
  // the host's watchdog replaced a worker that did not come back
  'hard-timeout',
  // the program failed on its own terms: memory, stack, a throw, a size
  'refused',
  // nothing answered: no socket, a lost worker, a stalled transport
  'unavailable',
] as const

type Outcome = (typeof OUTCOMES)[number]

const duration = boundedDurationHistogram(
  'qualy.sandbox.invoke.duration',
  { outcome: OUTCOMES },
  DURATION_BOUNDARIES,
)

const outcomeOf = (exit: Exit.Exit<unknown, SandboxError>): Outcome | undefined => {
  if (Exit.isSuccess(exit)) return 'completed'
  // the caller left; the call says nothing about the sandbox
  if (Cause.hasInterruptsOnly(exit.cause)) return undefined
  const found = Cause.findErrorOption(exit.cause)
  // a defect: whatever broke, nothing answered
  if (Option.isNone(found)) return 'unavailable'
  const error = found.value
  switch (error._tag) {
    case 'SandboxTimeout':
      return error.phase === 'soft' ? 'soft-timeout' : 'hard-timeout'
    case 'SandboxUnavailable':
    case 'SandboxWorkerLost':
      return 'unavailable'
    default:
      return 'refused'
  }
}

// Inside the runtime, which only the runtime can see: how long a call waited
// for a worker (a cold one's start included) and how long it ran there. Said
// by the runtime in its answer, and written here as attributes of the call's
// own span and as two histograms - never as child spans made up afterwards,
// whose times the trace would have to invent. Milliseconds are the scale, so
// the buckets start below the general ones.
const INSIDE_BOUNDARIES = [
  0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5,
] as const

const queued = boundedDurationHistogram(
  'qualy.sandbox.runtime.queue.duration',
  {},
  INSIDE_BOUNDARIES,
)
const executed = boundedDurationHistogram(
  'qualy.sandbox.runtime.execute.duration',
  {},
  INSIDE_BOUNDARIES,
)

/** what the runtime said of the time inside one call, on the span and the histograms */
const insideOf = (timings: RuntimeTimings | undefined) =>
  timings === undefined
    ? Effect.void
    : Effect.andThen(
        Effect.annotateCurrentSpan({
          'sandbox.queue.duration_ms': timings.queueMs,
          'sandbox.execute.duration_ms': timings.executeMs,
        }),
        Effect.andThen(queued({}, timings.queueMs / 1000), executed({}, timings.executeMs / 1000)),
      )

/**
 * One sandbox call, timed on every exit but a caller's own interruption, as
 * a span of its own: the rpc client's span sits under it, and what the
 * runtime said of the time inside is written on it.
 */
export const measuredInvoke = <R>(
  effect: Effect.Effect<SandboxAnswer, SandboxError, R>,
): Effect.Effect<SandboxAnswer, SandboxError, R> =>
  Effect.suspend(() => {
    const started = performance.now()
    return effect.pipe(
      Effect.tap((answer) => insideOf(answer.timings)),
      Effect.onExit((exit) => {
        const outcome = outcomeOf(exit)
        return outcome === undefined
          ? Effect.void
          : duration({ outcome }, (performance.now() - started) / 1000)
      }),
    )
  }).pipe(Effect.withSpan('SandboxRuntime.invoke'))
