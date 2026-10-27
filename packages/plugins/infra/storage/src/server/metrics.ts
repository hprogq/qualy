import { Cause, Effect, Exit } from 'effect'
import {
  DURATION_BOUNDARIES,
  boundedCounter,
  boundedDurationHistogram,
} from '@qualy/telemetry/metrics'
import {
  AttachmentInvalid,
  AttachmentNotFound,
  ReservationInvalid,
  ReservationNotFound,
  UploadRefused,
} from '../errors.ts'

/**
 * A caller's authorizer refusing, carried past the counter and unwrapped
 * before it leaves storage: the caller is told exactly what it failed with.
 */
export class AuthorizationRefused<E> {
  readonly error: E
  constructor(error: E) {
    this.error = error
  }
}

/** the answers an operation may give that are not failures: nothing to read, or a refusal */
const expected = (error: unknown) =>
  error instanceof AuthorizationRefused ||
  error instanceof AttachmentNotFound ||
  error instanceof AttachmentInvalid ||
  error instanceof ReservationNotFound ||
  error instanceof ReservationInvalid ||
  error instanceof UploadRefused

// How long storage work takes and how often it fails, one label: which
// operation. Backends, buckets, object keys and tenants stay out - the
// operation name is the entire dimension space.

const OPERATIONS = [
  'prepare_upload',
  'complete_upload',
  'metadata',
  'bind',
  'open',
  'read',
  'retire',
  'receive_upload',
  'sweep_abandoned_uploads',
  'sweep_staged_attachments',
  'reconcile_revisions',
] as const

type Operation = (typeof OPERATIONS)[number]

const duration = boundedDurationHistogram(
  'qualy.storage.operation.duration',
  { operation: OPERATIONS },
  DURATION_BOUNDARIES,
)

const failure = boundedCounter('qualy.storage.operation.failure', { operation: OPERATIONS })

/**
 * Wraps one storage operation: duration on every exit, failure on every exit
 * that holds a defect or a typed failure that is not one of the expected
 * answers. An absent file or a refused reader is the operation working; a
 * crashed upload or a backend down is not, and a cause mixing the two still
 * counts. A pure interruption is neither.
 */
export const measured =
  (operation: Operation) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const started = performance.now()
      return effect.pipe(
        Effect.onExit((exit) => {
          const failed =
            Exit.isFailure(exit) &&
            exit.cause.reasons.some(
              (reason) =>
                Cause.isDieReason(reason) ||
                (Cause.isFailReason(reason) && !expected(reason.error)),
            )
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
