import { Effect } from 'effect'
import { sql } from 'kysely'
import { db } from '../server/db.ts'

// What input collection reads that no other module already provides: the
// participant's entries with the payload each stands on, and the caller's
// own membership row whatever its status - an excluded member still reads
// the history they took part in (§32.56).

const epoch = (column: string) =>
  sql<number | null>`(extract(epoch from ${sql.ref(column)}) * 1000)::float8`

const msOf = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(value ?? 0)

export const participantRowByUser = (tenantId: string, batchId: string, userId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchParticipant')
        .select(['id', 'status'])
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .where('userId', '=', userId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : {
              id: String((row as Record<string, unknown>)['id']),
              status: String((row as Record<string, unknown>)['status']),
            },
      ),
    )

export interface ScoredEntryRow {
  id: string
  itemId: string
  status: string
  revisionId: string | null
  payload: unknown
  createdAt: number
}

/** every entry this participant holds in the batch, with the payload it stands on */
export const participantEntries = (tenantId: string, batchId: string, participantId: string) =>
  db
    .query((k) =>
      sql`
        select e.id, e.item_id, e.status, e.current_revision_id, er.payload,
               ${epoch('e.created_at')} as created_ms
        from entries e
        left join entry_revisions er
          on er.tenant_id = e.tenant_id and er.id = e.current_revision_id
        where e.tenant_id = ${tenantId}
          and e.batch_id = ${batchId}
          and e.participant_id = ${participantId}
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        (rows as Record<string, unknown>[]).map((row): ScoredEntryRow => ({
          id: String(row['id']),
          itemId: String(row['item_id']),
          status: String(row['status']),
          revisionId:
            row['current_revision_id'] == null ? null : String(row['current_revision_id']),
          payload: row['payload'] ?? null,
          createdAt: msOf(row['created_ms']),
        })),
      ),
    )
