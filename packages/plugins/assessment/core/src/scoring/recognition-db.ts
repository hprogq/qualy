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

const epoch = (column: string) =>
  sql<number | null>`(extract(epoch from ${sql.ref(column)}) * 1000)::float8`

export interface RecognitionWrite {
  readonly tenantId: string
  readonly batchId: string
  readonly entryId: string
  readonly entryRevisionId: string
  readonly itemId: string
  readonly itemRevisionId: string
  readonly values: Readonly<Record<string, unknown>>
  readonly source: 'review' | 'record' | 'import' | 'system' | 'redetermination'
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
    .pipe(Effect.map((row) => String(row.id)))

export interface RecognitionRow {
  readonly id: string
  readonly values: Record<string, unknown>
  readonly supersedesId: string | null
  /** the filing this determination judged: what keeps a seed on its own material */
  readonly entryRevisionId: string
}

/** the determination an entry currently stands on, if it has one */
export const currentRecognitionOf = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRecognition as r')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'r.tenantId').onRef('e.currentRecognitionId', '=', 'r.id'),
        )
        .select(['r.id', 'r.values', 'r.supersedesId', 'r.entryRevisionId'])
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
              values: (row as { values: Record<string, unknown> }).values ?? {},
              supersedesId: (row as { supersedesId: string | null }).supersedesId ?? null,
              entryRevisionId: String((row as { entryRevisionId: string }).entryRevisionId),
            } satisfies RecognitionRow),
      ),
    )

/**
 * One determination by its own id: what an appeal that names one inherits.
 *
 * Scoped to the entry so a pointer cannot reach across claims, exactly like
 * the foreign key that stores it.
 */
export const recognitionById = (tenantId: string, entryId: string, recognitionId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRecognition')
        .select(['id', 'values', 'supersedesId', 'entryRevisionId'])
        .where('tenantId', '=', tenantId)
        .where('entryId', '=', entryId)
        .where('id', '=', recognitionId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : ({
              id: String((row as { id: string }).id),
              values: (row as { values: Record<string, unknown> }).values ?? {},
              supersedesId: (row as { supersedesId: string | null }).supersedesId ?? null,
              entryRevisionId: String((row as { entryRevisionId: string }).entryRevisionId),
            } satisfies RecognitionRow),
      ),
    )

/**
 * What each of these claims currently stands recognised as, in one query.
 *
 * The staff account reads a page of claims and says what each was
 * determined to be, so asking per claim would be a query per row. Claims
 * with no determination simply do not come back - "nothing has been decided
 * yet" is the absence of a row, not a row saying nothing.
 *
 * It carries who and when, which `currentRecognitionOf` deliberately does
 * not: that one feeds arithmetic, and arithmetic has no use for an actor.
 */
export interface RecognitionDetail extends RecognitionRow {
  readonly entryId: string
  /** the question version it was judged under, which names its own fields */
  readonly itemRevisionId: string
  readonly source: 'review' | 'record' | 'import' | 'system' | 'redetermination'
  readonly createdAt: number
  readonly createdBy: string | null
  readonly createdByName: string | null
  /** the round that wrote it resolved a sitting of several reviewers */
  readonly panelResolved: boolean
}

export const currentRecognitionsOfEntries = (tenantId: string, entryIds: readonly string[]) =>
  entryIds.length === 0
    ? Effect.succeed([] as readonly RecognitionDetail[])
    : db
        .query((k) =>
          k
            .selectFrom('EntryRecognition as r')
            .innerJoin('Entry as e', (join) =>
              join
                .onRef('e.tenantId', '=', 'r.tenantId')
                .onRef('e.currentRecognitionId', '=', 'r.id'),
            )
            .leftJoin('User as u', (join) =>
              join.onRef('u.tenantId', '=', 'r.tenantId').onRef('u.id', '=', 'r.createdBy'),
            )
            .select([
              'r.id',
              'r.entryId',
              'r.values',
              'r.supersedesId',
              'r.entryRevisionId',
              'r.itemRevisionId',
              'r.source',
              'r.createdBy',
              'u.displayName as createdByName',
            ])
            .select([epoch('r.created_at').as('createdMs')])
            // a sitting that actually resolved on the round that wrote it: an
            // unsigned determination is not proof of one, since single
            // reviewers' determinations were once written unsigned too
            .select((eb) =>
              eb
                .exists(
                  eb
                    .selectFrom('ReviewPanel as pn')
                    .select(eb.lit(1).as('one'))
                    .whereRef('pn.tenantId', '=', 'r.tenantId')
                    .whereRef('pn.reviewInstanceId', '=', 'r.reviewInstanceId')
                    .where('pn.state', '=', 'resolved'),
                )
                .as('panelResolved'),
            )
            .where('r.tenantId', '=', tenantId)
            .where('r.entryId', 'in', [...entryIds])
            .execute(),
        )
        .pipe(
          Effect.map((rows) =>
            rows.map((row) => {
              const one = row as Record<string, unknown>
              return {
                id: String(one['id']),
                entryId: String(one['entryId']),
                values: (one['values'] ?? {}) as Record<string, unknown>,
                supersedesId: one['supersedesId'] == null ? null : String(one['supersedesId']),
                entryRevisionId: String(one['entryRevisionId']),
                itemRevisionId: String(one['itemRevisionId']),
                source: String(one['source']) as RecognitionDetail['source'],
                createdAt: Number(one['createdMs'] ?? 0),
                createdBy: one['createdBy'] == null ? null : String(one['createdBy']),
                createdByName: one['createdByName'] == null ? null : String(one['createdByName']),
                panelResolved: one['panelResolved'] === true,
              } satisfies RecognitionDetail
            }),
          ),
        )

/** every determination one claim has had, oldest first, for telling its history */
export const recognitionsOfEntry = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRecognition')
        .select(['id', 'reviewInstanceId', 'values'])
        .where('tenantId', '=', tenantId)
        .where('entryId', '=', entryId)
        .orderBy('createdAt')
        .orderBy('id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          id: String(row.id),
          reviewInstanceId: row.reviewInstanceId == null ? null : String(row.reviewInstanceId),
          values: row.values ?? {},
        })),
      ),
    )
