/**
 * Writing determinations down.
 *
 * Two statements, both append-only: a determination is inserted, and the
 * entry is pointed at it. Nothing here ever updates a determination - the
 * table has no update path at all, which is what makes "recognised as
 * provincial, then as national" two facts in order instead of a value whose
 * history is gone.
 */

import { Effect } from 'effect'
import { sql } from 'kysely'
import { db } from '../server/db.ts'

const jsonb = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`

export interface RecognitionWrite {
  readonly tenantId: string
  readonly batchId: string
  readonly entryId: string
  readonly entryRevisionId: string
  readonly itemId: string
  readonly itemRevisionId: string
  readonly values: Readonly<Record<string, unknown>>
  readonly source: 'review' | 'record' | 'import' | 'system'
  readonly reviewInstanceId?: string | null
  readonly reviewEventId?: string | null
  readonly supersedesId?: string | null
  readonly createdBy?: string | null
}

export const insertRecognition = (input: RecognitionWrite) =>
  db
    .query((k) =>
      k
        .insertInto('EntryRecognition')
        .values({
          tenantId: input.tenantId,
          batchId: input.batchId,
          entryId: input.entryId,
          entryRevisionId: input.entryRevisionId,
          itemId: input.itemId,
          itemRevisionId: input.itemRevisionId,
          values: jsonb(input.values),
          source: input.source,
          reviewInstanceId: input.reviewInstanceId ?? null,
          reviewEventId: input.reviewEventId ?? null,
          supersedesId: input.supersedesId ?? null,
          createdBy: input.createdBy ?? null,
        } as never)
        .returning(['id'])
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => String((row as { id: string }).id)))

export interface RecognitionRow {
  readonly id: string
  readonly values: Record<string, unknown>
  readonly supersedesId: string | null
}

/** the determination an entry currently stands on, if it has one */
export const currentRecognitionOf = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRecognition as r')
        .innerJoin('Entry as e', (join) =>
          join
            .onRef('e.tenantId', '=', 'r.tenantId')
            .onRef('e.currentRecognitionId', '=', 'r.id'),
        )
        .select(['r.id', 'r.values', 'r.supersedesId'])
        .where('r.tenantId', '=', tenantId)
        .where('r.entryId', '=', entryId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : ({
              id: String((row as { id: string }).id),
              values: ((row as { values: Record<string, unknown> }).values ?? {}) as Record<
                string,
                unknown
              >,
              supersedesId: (row as { supersedesId: string | null }).supersedesId ?? null,
            } satisfies RecognitionRow),
      ),
    )
