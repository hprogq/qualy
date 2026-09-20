import { Effect } from 'effect'
import { message } from '@qualy/i18n-contract'
import type { NodeUsageReporter } from '@qualy/org-contract/plugin'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import { db } from './db.ts'

// The rounds that hold a unit in place, said to whoever is about to delete
// it: a round administered from the unit, and a round whose participants
// were frozen as standing there. Both are facts a round keeps for good, so
// neither is something the organization screen can clear - the reader is
// told which rounds, by name, and taken to the first of them.

const EXAMPLES = 3

export const batchesAtNode: NodeUsageReporter<Orm> = {
  id: 'assessment/batches',
  bind: Effect.gen(function* () {
    const withDb = yield* withDatabase
    return (tenantId, orgNodeId) =>
      withDb(
        db.query(async (k) => {
          const administered = await k
            .selectFrom('BatchManagementAnchor as a')
            .innerJoin('AssessmentBatch as b', (join) =>
              join.onRef('b.tenantId', '=', 'a.tenantId').onRef('b.id', '=', 'a.batchId'),
            )
            .where('a.tenantId', '=', tenantId)
            .where('a.orgNodeId', '=', orgNodeId)
            .select(['b.id', 'b.name'])
            .orderBy('b.name')
            .execute()
          const frozen = await k
            .selectFrom('BatchParticipant as p')
            .innerJoin('AssessmentBatch as b', (join) =>
              join.onRef('b.tenantId', '=', 'p.tenantId').onRef('b.id', '=', 'p.batchId'),
            )
            .where('p.tenantId', '=', tenantId)
            .where('p.assessmentAnchorNodeId', '=', orgNodeId)
            .select(['b.id', 'b.name'])
            .distinct()
            .orderBy('b.name')
            .execute()
          const way = (rows: readonly { id: string }[]) =>
            rows[0] === undefined
              ? {}
              : { target: { pageId: 'assessment/batch', params: { batchId: rows[0].id } } }
          return [
            {
              kind: 'managed-batches',
              label: message('assessment/node-usage/managed', 'Rounds administered from here'),
              count: administered.length,
              examples: administered.slice(0, EXAMPLES).map((row) => row.name),
              ...way(administered),
            },
            {
              kind: 'participant-batches',
              label: message(
                'assessment/node-usage/participants',
                'Rounds whose participants were recorded here',
              ),
              count: frozen.length,
              examples: frozen.slice(0, EXAMPLES).map((row) => row.name),
              ...way(frozen),
            },
          ]
        }),
      ).pipe(Effect.orDie)
  }),
}
