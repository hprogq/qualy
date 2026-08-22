import { Duration, Effect, Layer, Schedule } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import { Assessment } from '../server/index.ts'

// The clock's own hand on the plan, and the patrol that keeps the review
// queues true.
//
// Everything about which boundaries have been crossed is already decided
// elsewhere: the engine answers it from the plan and an instant, and the gate
// reads that answer directly, so a phase takes effect at its planned second
// whether or not this fiber ever runs. What is left for a scheduler is
// bookkeeping - writing down what is already true - and that is the whole
// job here. It follows that being late is harmless, that running twice is
// harmless, and that this file owns cadence and nothing else.
//
// Single instance, stated the way the migrator states it: one process runs
// this. Two would not corrupt anything - every write is conditional on the
// actual still being null, so the loser writes nothing and reports nothing -
// but nobody has needed a second process, so no lock is bought for one.
// Redis, a queue or a distributed lock arrive when a deployment has more than
// one node, not before.

/** how often the sweep runs; a minute is the resolution phase boundaries need */
export const SWEEP_INTERVAL = '1 minute'

const WINDOW = Duration.toMillis(Duration.fromInputUnsafe(SWEEP_INTERVAL))

/**
 * The cadence: the grid `Schedule.fixed` draws, without its catch-up.
 *
 * `fixed` answers with a zero delay for as long as the action overruns the
 * window (repos/effect/packages/effect/src/Schedule.ts:948-950), so one slow
 * sweep turns the loop into a run with no pause in it, and the next one
 * inherits the same verdict. The review patrol's cost grows with the number
 * of open rounds in the tenant, so overrunning a minute is a thing this
 * sweep can actually do, and a background loop that answers slowness by
 * never letting go of the pool is worse than a late boundary. Boundaries the
 * sweep ran past are dropped rather than replayed: there is nothing to
 * replay, since each sweep writes down everything the clock has crossed.
 */
export const sweepSchedule = Schedule.fixed(SWEEP_INTERVAL).pipe(
  Schedule.modifyDelay(({ duration, elapsed }) =>
    Effect.succeed(
      Duration.isZero(duration) ? Duration.millis(WINDOW - (elapsed % WINDOW)) : duration,
    ),
  ),
)

/**
 * One sweep, with its failures kept off the fiber.
 *
 * A sweep that throws must not end the loop: the next minute is a perfectly
 * good time to try again, and a scheduler that dies quietly on one bad
 * transaction is worse than one that logs and continues. Defects included -
 * this is a background loop, so there is no caller to hand anything to.
 */
const sweep = Effect.gen(function* () {
  const assessment = yield* Assessment
  const report = yield* assessment.sweepDueBoundaries
  if (report.ratified > 0) {
    yield* Effect.logInfo(
      `ratified ${report.ratified} phase boundary(s) across ${report.scanned} batch(es)`,
    )
  }
  // the review patrol rides the same minute (§14): who can review changes
  // through half a dozen writes in two plugins, none of which this domain
  // may hook, so the queues are kept true by looking rather than by being
  // told - and looking heals in both directions
  const patrol = yield* assessment.patrolReviewRounds
  if (patrol.blocked > 0 || patrol.released > 0) {
    yield* Effect.logInfo(
      `review patrol: ${patrol.blocked} round(s) waiting on an appointment, ${patrol.released} released`,
    )
  }
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logError('assessment sweep failed; retrying on the next tick', cause),
  ),
)

/**
 * The loop, forked at the assembly barrier into the layer's own scope.
 *
 * At the barrier because a background fiber should not start writing while
 * the rest of the assembly is still being built; into this layer's scope
 * because that is the lifetime it belongs to - shutdown closes the scope and
 * the fiber goes with it, which is what makes SIGTERM prompt rather than
 * something with a timeout attached to it.
 *
 * `sweepSchedule` rather than `spaced`: the cadence should be a minute of
 * wall clock, not a minute after however long the last sweep took.
 */
export const schedulerLayer: Layer.Layer<never, never, Assessment | Assembled> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const assembled = yield* Assembled
      // the service is bound here, at registration, because a boot hook carries
      // no requirements: the host runs what plugins hand it, and never learns
      // what any of them needed
      const loop = Effect.repeat(sweep, sweepSchedule).pipe(
        Effect.provideService(Assessment, yield* Assessment),
      )
      yield* assembled.register({
        name: 'assessment/phase-scheduler',
        run: Effect.gen(function* () {
          yield* Effect.forkIn(loop, scope)
          yield* Effect.logDebug(`phase scheduler sweeping every ${SWEEP_INTERVAL}`)
        }),
      })
    }),
  )
