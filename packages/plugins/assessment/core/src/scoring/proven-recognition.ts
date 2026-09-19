import { Effect } from 'effect'
import { EntryPayloadInvalid } from '../errors.ts'
import { canonicalRecognition, judgeRecognition } from './recognition.ts'
import type { ScoringPlan } from './plan.ts'

/**
 * A determination, judged against the plan that will have to read it, and
 * then spelled the one way the contract says it means.
 *
 * Every door that produces an approved claim goes through here. Canonicalizing
 * without judging is not enough: canonicalization copies through keys it has
 * no schema for and leaves ill-typed ones alone, so an unjudged determination
 * either reaches the scorer with a field missing - where the failure is a
 * defect, surfacing as a 500 long after the door that let it in - or is stored
 * with a key the plan never named.
 *
 * On its own because three doors write determinations and one of them, the
 * bulk administrative record, did not have this.
 */
export const provenRecognition = (
  plan: ScoringPlan,
  candidate: unknown,
): Effect.Effect<Record<string, unknown>, EntryPayloadInvalid> => {
  const wrong = judgeRecognition(plan.recognitionSchemas, candidate)
  return wrong.length === 0
    ? Effect.succeed(
        // a value written "3.0" and read back "3.00" would make every later
        // comparison a fact about who typed it
        canonicalRecognition(plan.recognitionSchemas, candidate as Record<string, unknown>),
      )
    : Effect.fail(
        new EntryPayloadInvalid({
          issues: wrong.map((issue) => ({
            field:
              issue.recognitionId === '' ? 'recognition' : `recognition.${issue.recognitionId}`,
            reason: issue.reason,
          })),
        }),
      )
}
