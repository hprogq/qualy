import { Effect } from 'effect'
import { db } from '../server/db.ts'
import { readPolicy } from '../review/chain.ts'

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
}

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
            .select(['i.id', 'i.status', 'r.reviewPolicy'])
            .where('i.tenantId', '=', tenantId)
            .where('i.id', 'in', [...itemIds])
            .execute(),
        )
        .pipe(
          Effect.map(
            (rows) =>
              new Map(
                rows.map((row): [string, QuestionFacts] => [
                  row.id,
                  {
                    active: row.status === 'active',
                    appealRoute: readPolicy(row.reviewPolicy).escalation.length > 0,
                  },
                ]),
              ),
          ),
        )
