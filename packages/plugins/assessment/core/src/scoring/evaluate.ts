/**
 * What each approved entry is worth, decided before the ledger opens.
 *
 * This is the effectful half of scoring, and the only half that may be: it
 * resolves a calculator, builds the typed input its contract asks for, and
 * asks it for an amount. The ledger below stays a pure function of amounts,
 * which is what keeps "the same frozen facts give the byte-identical
 * breakdown" true whatever a calculator has to reach for.
 *
 * The input is assembled from a FROZEN plan, never inferred here: every
 * parameter was bound and proven assignable when the item revision was
 * saved, and a converter that has to run was recorded by name then. Guessing
 * a binding at scoring time would move the type proof to the worst possible
 * moment - in front of a student, in the middle of a total.
 */

import { Data, Effect } from 'effect'
import { validateValue } from '@qualy/value-schema/validate'
import { applyAssignment } from '@qualy/value-schema'
import type { PreparedCalculator } from '../plugin.ts'
import type { ScoringPlan } from './plan.ts'
import { scaledAmount } from './builtins.ts'

/** what one approved entry is worth, and everything that decided it */
export interface EvaluatedEntry {
  readonly entryId: string
  readonly entryRevisionId: string | null
  readonly itemId: string
  /** scaled by 1e4, exact */
  readonly amount: bigint
  readonly calculatorRef: string
}

/** the scoring facts one evaluation needs about an entry */
export interface EvaluationFact {
  readonly entryId: string
  readonly entryRevisionId: string | null
  readonly itemId: string
  /** the item revision's frozen plan; the arithmetic this entry is scored by */
  readonly plan: ScoringPlan
  /** the recognized values, keyed by recognition id; empty until a plan has any */
  readonly recognition: Readonly<Record<string, unknown>>
}

/** a calculator answered something the host had already proven impossible */
export class ScoringEvaluationFailed extends Data.TaggedError(
  'ASSESSMENT_SCORING_EVALUATION_FAILED',
)<{
  readonly itemId: string
  readonly reason: string
}> {}

/**
 * The calculator's input for one entry, assembled from the plan alone.
 *
 * Constants come from the plan verbatim; recognized values come from the
 * entry's recognition under the recognition id the plan named, through the
 * converter the plan recorded.
 */
const inputFor = (plan: ScoringPlan, recognition: Readonly<Record<string, unknown>>) => {
  // parameter names come from a calculator contract and recognition ids from
  // a stored plan: a null prototype so neither can reach `constructor` or
  // assign through `__proto__` on the way into the arithmetic
  const input: Record<string, unknown> = Object.create(null)
  for (const [parameter, binding] of Object.entries(plan.parameters)) {
    input[parameter] =
      binding.kind === 'constant'
        ? binding.value
        : applyAssignment(
            binding.assignment,
            Object.hasOwn(recognition, binding.recognitionId)
              ? recognition[binding.recognitionId]
              : undefined,
          )
  }
  return input
}

/**
 * One entry's amount: build the input, prove it against the frozen contract,
 * ask the calculator, prove the answer, scale it.
 *
 * The calculator arrives already prepared - resolved and closed over what
 * its plan needs, once, by the caller - so this function runs per entry
 * without paying any per-entry resolution.
 *
 * Both proofs are the host's, on both sides of an untrusted boundary. The
 * input was assembled from facts this process stored, so a failure there is
 * a defect in this file or a plan that no longer matches its calculator; the
 * output arrives from arithmetic that may live in another process entirely.
 */
export const evaluateEntry = (
  calculator: PreparedCalculator,
  fact: EvaluationFact,
): Effect.Effect<EvaluatedEntry, ScoringEvaluationFailed> =>
  Effect.gen(function* () {
    const plan = fact.plan
    const input = inputFor(plan, fact.recognition)
    const wrong = validateValue(plan.inputSchema, input)
    if (wrong.length > 0) {
      return yield* new ScoringEvaluationFailed({
        itemId: fact.itemId,
        reason: `input ${wrong[0]!.path} ${wrong[0]!.reason}`,
      })
    }
    const answer = yield* calculator
      .evaluate(input)
      .pipe(
        Effect.mapError(
          (failure) => new ScoringEvaluationFailed({ itemId: fact.itemId, reason: failure.reason }),
        ),
      )
    const outputWrong = validateValue(plan.outputSchema, answer)
    if (outputWrong.length > 0) {
      return yield* new ScoringEvaluationFailed({
        itemId: fact.itemId,
        reason: `output ${outputWrong[0]!.reason}`,
      })
    }
    return {
      entryId: fact.entryId,
      entryRevisionId: fact.entryRevisionId,
      itemId: fact.itemId,
      amount: scaledAmount(answer),
      calculatorRef: plan.calculator.ref,
    }
  })
