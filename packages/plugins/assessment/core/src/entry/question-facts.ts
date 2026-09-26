import { Effect } from 'effect'
import { db } from '../server/db.ts'
import { policyModeOf, readPolicy, routeReaches, type PolicyStage } from '../review/chain.ts'
import { opensTo, readEntryChannels } from '../item/channels.ts'

/**
 * What a question itself allows on the claims filed under it, whatever the
 * phase says: a withdrawn question takes no new version, round or appeal,
 * and a question with no escalation step has nowhere to hear an appeal.
 * The writes refuse on the same facts (`item-not-active`, `no-appeal-route`),
 * so every screen that offers those acts reads them from here.
 */
export interface QuestionFacts {
  readonly active: boolean
  readonly appealRoute: boolean
  /** whether its current version asks participants to file */
  readonly participantFiled: boolean
  /**
   * The route a submission walks, or null for a question that answers to
   * nobody (`mode: 'none'`), where the submission is the decision.
   */
  readonly normal: readonly PolicyStage[] | null
  /** the route an appeal walks; empty where there is none */
  readonly escalation: readonly PolicyStage[]
}

/**
 * Why a submission by somebody on this lineage would find nowhere to stand,
 * or null when it would. The write refuses the same way
 * (`review-level-missing`), after the phase: a question whose every step
 * names a level this person sits under none of.
 */
export const submitRouteRefusal = (
  question: QuestionFacts,
  lineage: readonly { readonly nodeTypeId: string }[],
): 'review-level-missing' | null =>
  question.normal !== null && !routeReaches(question.normal, lineage)
    ? 'review-level-missing'
    : null

/** the same question about an appeal, which walks the escalation route alone */
export const appealRouteRefusal = (
  question: QuestionFacts,
  lineage: readonly { readonly nodeTypeId: string }[],
): 'review-level-missing' | null =>
  question.escalation.length > 0 && !routeReaches(question.escalation, lineage)
    ? 'review-level-missing'
    : null

/** the facts for each named question, in one read */
export const questionFactsOf = (tenantId: string, itemIds: readonly string[]) =>
  itemIds.length === 0
    ? Effect.succeed(new Map<string, QuestionFacts>())
    : db
        .query((k) =>
          k
            .selectFrom('AssessmentItem as i')
            .leftJoin('AssessmentItemRevision as r', (join) =>
              join.onRef('r.tenantId', '=', 'i.tenantId').onRef('r.id', '=', 'i.currentRevisionId'),
            )
            .select(['i.id', 'i.status', 'r.reviewPolicy', 'r.entryChannels'])
            .where('i.tenantId', '=', tenantId)
            .where('i.id', 'in', [...itemIds])
            .execute(),
        )
        .pipe(
          Effect.map(
            (rows) =>
              new Map(
                rows.map((row): [string, QuestionFacts] => {
                  const policy = readPolicy(row.reviewPolicy)
                  return [
                    row.id,
                    {
                      active: row.status === 'active',
                      appealRoute: policy.escalation.length > 0,
                      participantFiled: opensTo(
                        readEntryChannels(row.entryChannels),
                        'participant',
                      ),
                      // no current version is `item-not-configured`, which
                      // the writes say first; it is no claim about the route
                      normal:
                        row.reviewPolicy == null || policyModeOf(row.reviewPolicy) === 'none'
                          ? null
                          : policy.normal,
                      escalation: policy.escalation,
                    },
                  ]
                }),
              ),
          ),
        )
