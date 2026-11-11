import { Effect } from 'effect'
import { readScoringPlan } from './plan.ts'
import { recognitionFormFields } from './recognition.ts'
import type { RecognitionDetail } from './recognition-db.ts'

/** Project a determination with the exact schemas frozen when it was written. */
export const recognitionViewOf = (standing: RecognitionDetail, veiled: boolean) =>
  Effect.gen(function* () {
    const plan = yield* readScoringPlan({
      id: standing.itemRevisionId,
      scoringPlan: standing.scoringPlan,
    }).pipe(Effect.option)
    return {
      id: standing.id,
      source: standing.source,
      entryRevisionId: standing.entryRevisionId,
      fields: (plan._tag === 'Some' ? recognitionFormFields(plan.value) : null) ?? [],
      values: standing.values,
      createdAt: standing.createdAt,
      actorName: veiled ? null : standing.createdByName,
      byPanel:
        standing.source === 'review' && standing.createdBy === null && standing.panelResolved,
    }
  })
