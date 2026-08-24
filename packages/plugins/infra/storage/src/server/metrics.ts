import { Cause, Effect, Exit } from 'effect'
import {
  DURATION_BOUNDARIES,
  boundedCounter,
  boundedDurationHistogram,
} from '@qualy/telemetry/metrics'

// How long storage work takes and how often it fails, one label: which
// operation. Backends, buckets, object keys and tenants stay out - the
// operation name is the entire dimension space.

const OPERATIONS = [
  'prepare_upload',
  'complete_upload',
  'metadata',
  'bind',
  'open',
  'retire',
  'receive_upload',
  'sweep_abandoned_uploads',
  'sweep_staged_attachments',
] as const

type Operation = (typeof OPERATIONS)[number]

const duration = boundedDurationHistogram(
  'qualy.storage.operation.duration',
  { operation: OPERATIONS },
  DURATION_BOUNDARIES,
)

const failure = boundedCounter('qualy.storage.operation.failure', { operation: OPERATIONS })

/**
 * Wraps one storage operation: duration on every exit, failure on every
 * exit that is not a success and not a pure interruption. An operations
 * metric counts defects on purpose - a crashed upload is more of a failure
 * than a typed refusal, not less.
 */
export const measured =
  (operation: Operation) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const started = performance.now()
      return effect.pipe(
        Effect.onExit((exit) => {
          const failed = Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
          return Effect.all(
            [
              duration({ operation }, (performance.now() - started) / 1000),
              ...(failed ? [failure({ operation })] : []),
            ],
            { discard: true },
          )
        }),
      )
    })
