import { Clock, Duration, Effect, Layer, Queue, Schedule, Stream } from 'effect'
import {
  DURATION_BOUNDARIES,
  boundedCounter,
  boundedDurationHistogram,
} from '@qualy/telemetry/metrics'
import { Assembled } from '@qualy/api-kit/assembled'
import { AssessmentLive } from '../live/service.ts'
import { Assessment } from '../server/index.ts'

// The clock's hand on the plan, and the patrol that keeps the review queues
// true. Two loops now, because the two jobs keep time differently.
//
// Everything about which boundaries have been crossed is already decided
// elsewhere: the engine answers it from the plan and an instant, and the gate
// reads that answer directly, so a phase takes effect at its planned second
// whether or not either fiber ever runs. What is left for a scheduler is
// bookkeeping - writing down what is already true - plus the wake-ups that
// bookkeeping sends to the browsers holding the batch open. Being late is
// harmless to correctness; it is only the wake-ups that arrive late, which
// is exactly why the phase loop aims itself at the diary instead of walking
// a grid: the next boundary is a known instant, and a reader watching the
// screen at that instant should see it turn.
//
// The patrol has no such instant to aim at. Who can review changes through
// half a dozen writes in two plugins, none of which this domain may hook, so
// the queues are kept true by looking, and looking has to be periodic.
//
// Single instance, stated the way the migrator states it: one process runs
// these. Two would not corrupt anything - every write is conditional - but
// nobody has needed a second process, so no lock is bought for one.

/** the review patrol's cadence; reconciliation has nothing to aim at */
export const PATROL_INTERVAL = '1 minute'

/**
 * How long the phase loop sleeps when the diary names nothing to wait for.
 *
 * A safety net, not the mechanism: with the alarm aimed at the next planned
 * instant and every plan edit waking the loop, this only catches what those
 * two miss - a signal lost to a bug, a clock stepped backwards, a boundary
 * the engine left unratified. Minutes are fine for a net; the design does
 * not lean on it.
 */
export const PHASE_FALLBACK = '5 minutes'

/**
 * How soon the loop looks again at a boundary it cannot ratify.
 *
 * An instant still in the past right after a sweep means the engine chose to
 * leave it - an armed manual boundary ahead of it - or that one sweep hit
 * its batch limit. Neither resolves on its own schedule, so the loop neither
 * spins on it nor forgets it.
 */
export const PHASE_RETRY = '15 seconds'

const FALLBACK_MILLIS = Duration.toMillis(Duration.fromInputUnsafe(PHASE_FALLBACK))
const RETRY_MILLIS = Duration.toMillis(Duration.fromInputUnsafe(PHASE_RETRY))

/**
 * The one instant of margin past a boundary before the sweep runs.
 *
 * The sweep's own `now` comes from the same clock the sleep does, so waking
 * exactly on the boundary would already find it due; the margin only covers
 * a timer that fires a hair early, which real runtimes do not promise never
 * to do.
 */
const WAKE_MARGIN = 1000

/**
 * How long the phase loop waits, given what the diary said.
 *
 * Pure, because this is the part worth pinning in a test: null means nothing
 * is scheduled anywhere and only the net remains; a past instant means the
 * engine left it there deliberately, retried on its own short cadence; a
 * future instant is the alarm, cut off at the net so a diary set months out
 * still gets swept occasionally.
 */
export const phasePause = (nextDueAt: number | null, now: number): Duration.Duration => {
  if (nextDueAt === null) return Duration.millis(FALLBACK_MILLIS)
  const until = nextDueAt - now
  if (until <= 0) return Duration.millis(RETRY_MILLIS)
  return Duration.millis(Math.min(until + WAKE_MARGIN, FALLBACK_MILLIS))
}

/**
 * The patrol's cadence: the grid `Schedule.fixed` draws, without its
 * catch-up.
 *
 * `fixed` answers with a zero delay for as long as the action overruns the
 * window (repos/effect/packages/effect/src/Schedule.ts:948-950), so one slow
 * patrol turns the loop into a run with no pause in it, and the next one
 * inherits the same verdict. The patrol's cost grows with the number of open
 * rounds in the tenant, so overrunning a minute is a thing it can actually
 * do, and a background loop that answers slowness by never letting go of the
 * pool is worse than a late reconciliation.
 */
export const patrolSchedule = Schedule.fixed(PATROL_INTERVAL).pipe(
  Schedule.modifyDelay(({ duration, elapsed }) =>
    Effect.succeed(
      Duration.isZero(duration)
        ? Duration.millis(
            Duration.toMillis(Duration.fromInputUnsafe(PATROL_INTERVAL)) -
              (elapsed % Duration.toMillis(Duration.fromInputUnsafe(PATROL_INTERVAL))),
          )
        : duration,
    ),
  ),
)

/**
 * One phase sweep, with its failures kept off the fiber.
 *
 * A sweep that throws must not end the loop: soon is a perfectly good time
 * to try again, and a scheduler that dies quietly on one bad transaction is
 * worse than one that logs and continues. Defects included - this is a
 * background loop, so there is no caller to hand anything to.
 */
/** every run measured, every death counted, one bounded label: which loop */
const runDuration = boundedDurationHistogram(
  'qualy.scheduler.run.duration',
  { job: ['phase-sweep', 'review-patrol'] },
  DURATION_BOUNDARIES,
)
const runFailure = boundedCounter('qualy.scheduler.run.failure', {
  job: ['phase-sweep', 'review-patrol'],
})

const timedRun =
  (job: 'phase-sweep' | 'review-patrol') =>
  <A, E, R>(run: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const started = performance.now()
      return run.pipe(
        Effect.onExit(() => runDuration({ job }, (performance.now() - started) / 1000)),
      )
    })

const sweepPhases = Effect.gen(function* () {
  const assessment = yield* Assessment
  const report = yield* assessment.sweepDueBoundaries
  if (report.ratified > 0) {
    yield* Effect.logInfo(
      `ratified ${report.ratified} phase boundary(s) across ${report.scanned} batch(es)`,
    )
  }
}).pipe(
  timedRun('phase-sweep'),
  Effect.catchCause((cause) =>
    runFailure({ job: 'phase-sweep' }).pipe(
      Effect.andThen(Effect.logError('phase sweep failed; retrying after the next pause', cause)),
    ),
  ),
)

const patrol = Effect.gen(function* () {
  const assessment = yield* Assessment
  const report = yield* assessment.patrolReviewRounds
  if (report.blocked > 0 || report.released > 0) {
    yield* Effect.logInfo(
      `review patrol: ${report.blocked} round(s) waiting on an appointment, ${report.released} released`,
    )
  }
}).pipe(
  timedRun('review-patrol'),
  Effect.catchCause((cause) =>
    runFailure({ job: 'review-patrol' }).pipe(
      Effect.andThen(Effect.logError('review patrol failed; retrying on the next tick', cause)),
    ),
  ),
)

/**
 * The phase loop: sweep, aim at the next boundary, sleep until it or until
 * somebody edits the diary - whichever comes first.
 *
 * The wake-up queue is sliding with room for one: signals carry no data, so
 * a burst of edits collapses into one extra sweep, and a signal arriving
 * mid-sweep waits in the queue and turns the pause into a recomputation
 * instead of being lost. The sweep's own announcement wakes the loop too;
 * that costs one no-op sweep per ratification and buys never having to ask
 * which announcements were self-inflicted.
 *
 * A failed alarm read falls back to the net rather than killing the loop.
 */
const phaseLoop = Effect.gen(function* () {
  const assessment = yield* Assessment
  const live = yield* AssessmentLive
  const wake = yield* Queue.sliding<void>(1)
  yield* Effect.forkChild(
    live.events.pipe(
      Stream.filter((event) => event.kind === 'plan-changed' || event.kind === 'phase-changed'),
      Stream.runForEach(() => Queue.offer(wake, undefined)),
    ),
  )
  return yield* Effect.forever(
    Effect.gen(function* () {
      yield* sweepPhases
      const next = yield* assessment.nextDueBoundary.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            'could not read the next boundary; using the fallback pause',
            cause,
          ).pipe(Effect.as(null)),
        ),
      )
      const now = yield* Clock.currentTimeMillis
      yield* Effect.race(Effect.sleep(phasePause(next, now)), Queue.take(wake))
    }),
  )
})

/**
 * Both loops, forked at the assembly barrier into the layer's own scope.
 *
 * At the barrier because a background fiber should not start writing while
 * the rest of the assembly is still being built; into this layer's scope
 * because that is the lifetime it belongs to - shutdown closes the scope and
 * the fibers go with it, which is what makes SIGTERM prompt rather than
 * something with a timeout attached to it.
 */
export const schedulerLayer: Layer.Layer<never, never, Assessment | AssessmentLive | Assembled> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const assembled = yield* Assembled
      // the services are bound here, at registration, because a boot hook
      // carries no requirements: the host runs what plugins hand it, and
      // never learns what any of them needed
      const phases = phaseLoop.pipe(
        Effect.provideService(Assessment, yield* Assessment),
        Effect.provideService(AssessmentLive, yield* AssessmentLive),
      )
      const patrolLoop = Effect.repeat(patrol, patrolSchedule).pipe(
        Effect.provideService(Assessment, yield* Assessment),
      )
      yield* assembled.register({
        name: 'assessment/phase-scheduler',
        run: Effect.gen(function* () {
          yield* Effect.forkIn(phases, scope)
          yield* Effect.forkIn(patrolLoop, scope)
          yield* Effect.logDebug(
            `phase scheduler aimed at the next boundary (net ${PHASE_FALLBACK}); review patrol every ${PATROL_INTERVAL}`,
          )
        }),
      })
    }),
  )
