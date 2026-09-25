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
import { ScoringUnavailable } from '../errors.ts'
import { evaluateRecognition, type ScoringEvaluationFailed } from './evaluate.ts'
import {
  countEvaluation,
  defectAt,
  mapRuntimeFailure,
  type FailureSite,
} from './failure-boundary.ts'
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

/**
 * How the candidate answered one determination the current rule scored, or
 * `baseline` where the current rule could not score it.
 *
 * That last one used to be a defect, which made a broken rule permanent:
 * the probe runs the current rule first on every row, so the one save that
 * would fix it - replacing the rule - answered 500 instead. It is a fact
 * about the question as it stands, said as one.
 */
type Verdict = 'same' | 'changed' | 'refused' | 'execution' | 'baseline'

/**
 * How many determinations are evaluated at once, here and in the audit.
 *
 * Bounded rather than unbounded because the arithmetic behind a stored
 * program is one shared sandbox; four keeps a large question moving
 * without turning a save into a burst against it.
 */
export const EVALUATION_CONCURRENCY = 4

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

/**
 * The current rule's failure on what stands: predates this save, never the
 * candidate's.
 *
 * An outage stops the trial, because a report with a hole in it is not a
 * report. Anything else is logged where a defect would have been logged and
 * then counted: the row is set aside rather than compared, and it is not
 * held against the candidate - a determination that is already unscorable
 * must not be what stops the rule that would score it.
 */
const baselineFailure = (
  site: FailureSite,
  error: ScoringEvaluationFailed,
): Effect.Effect<'baseline', ScoringUnavailable> =>
  error.kind === 'unavailable'
    ? Effect.fail(new ScoringUnavailable())
    : Effect.as(
        Effect.logError('scoring failed', {
          tenantId: site.tenantId,
          batchId: site.batchId,
          itemId: site.itemId,
          calculatorRef: site.plan.calculator.ref,
          kind: error.kind,
          reason: error.reason,
          boundary: 'impact-current',
        }),
        'baseline' as const,
      )

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
        }).pipe(
          countEvaluation('impact'),
          Effect.catch((error) => baselineFailure(at(trial.current), error)),
        )
        // nothing to compare against, and nothing to hold the candidate to
        if (before === 'baseline') return 'baseline' as const
        const after = yield* evaluateRecognition(candidate, {
          itemId: trial.itemId,
          plan: trial.candidate,
          recognition,
        }).pipe(
          countEvaluation('impact'),
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
      { concurrency: EVALUATION_CONCURRENCY },
    )
    const count = (verdict: Verdict) => verdicts.filter((one) => one === verdict).length
    const derived = trial.derived ? yield* tryOne({}) : null
    // A granted question is scored on its own amount at every read. Where
    // the rule it has cannot pay that amount either, there is nothing to
    // compare - but a candidate that cannot pay it would leave the question
    // exactly as broken, so it is asked on its own and held to its answer.
    const derivedAlone =
      derived === 'baseline'
        ? yield* evaluateRecognition(candidate, {
            itemId: trial.itemId,
            plan: trial.candidate,
            recognition: {},
          }).pipe(
            countEvaluation('impact'),
            Effect.map((): Verdict => 'same'),
            Effect.catch((error) => candidateVerdict(at(trial.candidate), error)),
          )
        : null
    return {
      changed: true,
      approved: {
        total: trial.standing.length,
        comparable: count('same') + count('changed'),
        amountChanged: count('changed'),
        refused: count('refused'),
        executionFailed: count('execution'),
        baselineFailed: count('baseline'),
      },
      derived:
        derived === null
          ? null
          : {
              comparable: derived === 'same' || derived === 'changed',
              amountChanged: derived === 'changed',
              refused: derived === 'refused' || derivedAlone === 'refused',
              executionFailed: derived === 'execution' || derivedAlone === 'execution',
              baselineFailed: derived === 'baseline',
            },
    }
  })

/**
 * Whether a granted question's rule pays its own amount, before the question
 * is put on the round.
 *
 * A derived question is scored at every read of every participant's account,
 * on the one determination it ever has - the empty one - and a failure there
 * is a defect, because a rule in force was tried before it took effect. This
 * is that trial for the moment a question takes effect without anything to
 * compare against: publishing it, or restoring it. An outage stops it; a
 * frozen promise broken is a defect here as everywhere.
 */
export const trialDerivedGrant = (
  runtime: ScoringRuntimeCatalog['Service'],
  site: FailureSite,
): Effect.Effect<
  { readonly refused: boolean; readonly executionFailed: boolean },
  ScoringUnavailable
> =>
  Effect.gen(function* () {
    const prepared = yield* runtime
      .prepare(site.plan.calculator.ref, frozenCalculatorOf(site.plan), {
        tenantId: site.tenantId,
        batchId: site.batchId,
      })
      .pipe(Effect.catch((error) => mapRuntimeFailure('impact-candidate', site, error)))
    const verdict = yield* evaluateRecognition(prepared, {
      itemId: site.itemId,
      plan: site.plan,
      recognition: {},
    }).pipe(
      countEvaluation('impact'),
      Effect.map((): Verdict => 'same'),
      Effect.catch((error) => candidateVerdict(site, error)),
    )
    return { refused: verdict === 'refused', executionFailed: verdict === 'execution' }
  })

/** what the trial leaves the caller unable to save: the candidate cannot take these */
export const trialRefuses = (scoring: ScoringImpact): boolean =>
  scoring.approved.refused + scoring.approved.executionFailed > 0 ||
  scoring.derived?.refused === true ||
  scoring.derived?.executionFailed === true

export type { PreparedCalculator }
