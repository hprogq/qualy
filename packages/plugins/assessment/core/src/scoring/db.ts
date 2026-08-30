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
        row === undefined ? null : { id: row.id, status: row.status as string },
      ),
    )

export interface ScoredEntryRow {
  id: string
  itemId: string
  status: string
  revisionId: string | null
  /** the determination this claim stands on, when it stands on one */
  recognitionId: string | null
  recognition: Record<string, unknown>
  createdAt: number
}

/** every entry this participant holds, with the determination it stands on */
export const participantEntries = (tenantId: string, batchId: string, participantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry as e')
        .leftJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'e.tenantId').onRef('er.id', '=', 'e.currentRevisionId'),
        )
        // the determination in the same read as the claim: two reads could
        // see an approval land between them and score a claim against a
        // recognition that was not the one it stood on
        .leftJoin('EntryRecognition as rec', (join) =>
          join
            .onRef('rec.tenantId', '=', 'e.tenantId')
            .onRef('rec.id', '=', 'e.currentRecognitionId'),
        )
        .select([
          'e.id',
          'e.itemId',
          'e.status',
          'e.currentRevisionId as revisionId',
          'e.currentRecognitionId as recognitionId',
          'rec.values as recognition',
        ])
        .select([epoch('e.created_at').as('createdMs')])
        .where('e.tenantId', '=', tenantId)
        .where('e.batchId', '=', batchId)
        .where('e.participantId', '=', participantId)
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): ScoredEntryRow => ({
          id: row.id,
          itemId: row.itemId,
          status: row.status as string,
          revisionId: row.revisionId,
          recognitionId: row.recognitionId ?? null,
          recognition: (row.recognition ?? {}) as Record<string, unknown>,
          createdAt: msOf(row.createdMs),
        })),
      ),
    )
