import { Cause, Effect, Exit, Option } from 'effect'
import { DURATION_BOUNDARIES, boundedDurationHistogram } from '@qualy/telemetry/metrics'
import type { SandboxError } from './errors.ts'

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

/** one sandbox call, timed on every exit but a caller's own interruption */
export const measuredInvoke = <A, R>(
  effect: Effect.Effect<A, SandboxError, R>,
): Effect.Effect<A, SandboxError, R> =>
  Effect.suspend(() => {
    const started = performance.now()
    return effect.pipe(
      Effect.onExit((exit) => {
        const outcome = outcomeOf(exit)
        return outcome === undefined
          ? Effect.void
          : duration({ outcome }, (performance.now() - started) / 1000)
      }),
    )
  })
