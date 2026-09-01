/**
 * What a candidate rule would make of the determinations already in force,
 * found by running both rules over every one of them.
 *
 * Outside any transaction, because the arithmetic may take a while and a
 * batch lock must not be held for it; bounded in its concurrency, because
 * a question may have thousands of determinations and the sandbox behind
 * them is shared. The current rule goes first on every row: only once the
 * baseline is known to be healthy can a difference be laid at the
 * candidate's door. A current rule that fails on what stands is a fault
 * that predates this save, and is said as one.
 */

import { Effect } from 'effect'
import type { PreparedCalculator, ScoringRuntimeCatalog } from '../plugin.ts'
import { ScoringUnavailable } from '../server/errors.ts'
import { evaluateRecognition, type ScoringEvaluationFailed } from './evaluate.ts'
import { defectAt, mapRuntimeFailure, type FailureSite } from './failure-boundary.ts'
import type { ScoringImpact } from '../item/impact.ts'
import { frozenCalculatorOf, type ScoringPlan } from './plan.ts'

/** a determination in force, as the trial needs it */
export interface StandingDetermination {
  readonly entryId: string
  readonly recognition: Readonly<Record<string, unknown>>
}

export interface ScoringTrial {
  readonly tenantId: string
  readonly batchId: string
  readonly itemId: string
  readonly current: ScoringPlan
  readonly candidate: ScoringPlan
  readonly standing: readonly StandingDetermination[]
  /** a granted question's own amount is tried too, on the empty determination */
  readonly derived: boolean
}

/** how the candidate answered one determination the current rule scored */
type Verdict = 'same' | 'changed' | 'refused' | 'execution'

/**
 * How many determinations are tried at once.
 *
 * Bounded rather than unbounded because the arithmetic behind a stored
 * program is one shared sandbox; four keeps a large question moving
 * without turning a save into a burst against it.
 */
const TRIAL_CONCURRENCY = 4

/**
 * The candidate's own failures, sorted for the trial.
 *
 * A refusal and a program that cannot compute both mean the candidate
 * cannot take these values; they are counted apart because they are
 * different things to fix. An outage stops the whole trial - a report
 * with a hole in it is not a report - and a frozen promise broken or a
 * state proven impossible is a defect wherever it happens.
 */
const candidateVerdict = (
  site: FailureSite,
  error: ScoringEvaluationFailed,
): Effect.Effect<Verdict, ScoringUnavailable> => {
  switch (error.kind) {
    case 'refusal':
      return Effect.succeed('refused')
    case 'execution':
      return Effect.succeed('execution')
    case 'unavailable':
      return Effect.fail(new ScoringUnavailable())
    default:
      return defectAt(site, error)
  }
}

/** the current rule's failure on what stands: predates this save, never the candidate's */
const baselineFailure = (
  site: FailureSite,
  error: ScoringEvaluationFailed,
): Effect.Effect<never, ScoringUnavailable> =>
  error.kind === 'unavailable' ? Effect.fail(new ScoringUnavailable()) : defectAt(site, error)

export const trialScoringImpact = (
  runtime: ScoringRuntimeCatalog['Service'],
  trial: ScoringTrial,
): Effect.Effect<ScoringImpact, ScoringUnavailable> =>
  Effect.gen(function* () {
    const at = (plan: ScoringPlan): FailureSite => ({
      tenantId: trial.tenantId,
      batchId: trial.batchId,
      itemId: trial.itemId,
      plan,
    })
    const prepare = (plan: ScoringPlan, boundary: 'impact-current' | 'impact-candidate') =>
      runtime
        .prepare(plan.calculator.ref, frozenCalculatorOf(plan), {
          tenantId: trial.tenantId,
          batchId: trial.batchId,
        })
        .pipe(Effect.catch((error) => mapRuntimeFailure(boundary, at(plan), error)))
    // the current rule first, and only once it is known to prepare does
    // the candidate get its turn: the same order every row keeps below
    const current = yield* prepare(trial.current, 'impact-current')
    const candidate = yield* prepare(trial.candidate, 'impact-candidate')

    const tryOne = (recognition: Readonly<Record<string, unknown>>) =>
      Effect.gen(function* () {
        const before = yield* evaluateRecognition(current, {
          itemId: trial.itemId,
          plan: trial.current,
          recognition,
        }).pipe(Effect.catch((error) => baselineFailure(at(trial.current), error)))
        const after = yield* evaluateRecognition(candidate, {
          itemId: trial.itemId,
          plan: trial.candidate,
          recognition,
        }).pipe(
          Effect.map((evaluated): Verdict =>
            evaluated.amount === before.amount ? 'same' : 'changed',
          ),
          Effect.catch((error) => candidateVerdict(at(trial.candidate), error)),
        )
        return after
      })

    const verdicts = yield* Effect.forEach(
      trial.standing,
      (row) => tryOne(row.recognition),
      // each row is a round trip to whatever runs the arithmetic; a
      // question with thousands of determinations must not open thousands
      { concurrency: TRIAL_CONCURRENCY },
    )
    const count = (verdict: Verdict) => verdicts.filter((one) => one === verdict).length
    const derived = trial.derived ? yield* tryOne({}) : null
    return {
      changed: true,
      approved: {
        total: trial.standing.length,
        comparable: count('same') + count('changed'),
        amountChanged: count('changed'),
        refused: count('refused'),
        executionFailed: count('execution'),
      },
      derived:
        derived === null
          ? null
          : {
              comparable: derived === 'same' || derived === 'changed',
              amountChanged: derived === 'changed',
              refused: derived === 'refused',
              executionFailed: derived === 'execution',
            },
    }
  })

/** what the trial leaves the caller unable to save: the candidate cannot take these */
export const trialRefuses = (scoring: ScoringImpact): boolean =>
  scoring.approved.refused + scoring.approved.executionFailed > 0 ||
  scoring.derived?.refused === true ||
  scoring.derived?.executionFailed === true

export type { PreparedCalculator }
