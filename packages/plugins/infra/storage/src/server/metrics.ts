import { Effect } from 'effect'
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

/** wraps one storage operation: duration on every exit, failure on typed errors */
export const measured =
  (operation: Operation) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const started = performance.now()
      return effect.pipe(
        Effect.tapError(() => failure({ operation })),
        Effect.onExit(() => duration({ operation }, (performance.now() - started) / 1000)),
      )
    })
