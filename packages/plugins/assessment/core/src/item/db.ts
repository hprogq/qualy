import { Effect } from 'effect'
import { sql } from 'kysely'
import { db } from '../server/db.ts'

// The item and score-group rows, as the configuration screens need them.
// Same conventions as the batch queries next door: instants leave as epoch
// milliseconds, jsonb comes back parsed, amounts stay strings.

const epoch = (column: string) =>
  sql<number | null>`(extract(epoch from ${sql.ref(column)}) * 1000)::float8`

const msOf = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(value ?? 0)

const jsonb = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`

export interface ScoreGroupRow {
  id: string
  name: string
  cap: string | null
  floor: string | null
  sortOrder: number
  itemCount: number
  createdAt: number
}

export const groupsOf = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ScoreGroup')
        .select(['id', 'name', 'sortOrder'])
        .select([
          sql<string | null>`cap::text`.as('capText'),
          sql<string | null>`floor::text`.as('floorText'),
          epoch('score_groups.created_at').as('createdMs'),
          sql<string>`(select count(*) from assessment_items ai
             where ai.tenant_id = score_groups.tenant_id
               and ai.batch_id = score_groups.batch_id
               and ai.score_group_id = score_groups.id)`.as('itemCount'),
        ])
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .orderBy('sortOrder')
        .orderBy('id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): ScoreGroupRow => ({
          id: row.id as string,
          name: row.name as string,
          cap: (row as { capText: string | null }).capText,
          floor: (row as { floorText: string | null }).floorText,
          sortOrder: row.sortOrder as number,
          itemCount: Number((row as { itemCount: unknown }).itemCount),
          createdAt: msOf((row as { createdMs: unknown }).createdMs),
        })),
      ),
    )

export const insertGroup = (input: {
  tenantId: string
  batchId: string
  name: string
  cap: string | null
  floor: string | null
  sortOrder: number
}) =>
  db
    .query((k) =>
      k
        .insertInto('ScoreGroup')
        .values({
          tenantId: input.tenantId,
          batchId: input.batchId,
          name: input.name,
          cap: input.cap,
          floor: input.floor,
          sortOrder: input.sortOrder,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => String((row as { id: unknown }).id)))

export const updateGroup = (input: {
  tenantId: string
  batchId: string
  id: string
  name: string
  cap: string | null
  floor: string | null
  sortOrder: number
}) =>
  db.query((k) =>
    k
      .updateTable('ScoreGroup')
      .set({
        name: input.name,
        cap: input.cap,
        floor: input.floor,
        sortOrder: input.sortOrder,
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', input.tenantId)
      .where('batchId', '=', input.batchId)
      .where('id', '=', input.id)
      .execute(),
  )

export const deleteGroups = (tenantId: string, batchId: string, ids: readonly string[]) =>
  ids.length === 0
    ? Effect.void
    : db.query((k) =>
        k
          .deleteFrom('ScoreGroup')
          .where('tenantId', '=', tenantId)
          .where('batchId', '=', batchId)
          .where('id', 'in', [...ids])
          .execute(),
      )

export interface ItemRevisionRow {
  id: string
  revisionNo: number
  entrySource: 'student' | 'administrative'
  formConfig: unknown
  scoringConfig: unknown
  reviewPolicy: unknown
  displayConfig: unknown
  createdBy: string
  reason: string | null
  createdAt: number
}

export interface ItemRow {
  id: string
  batchId: string
  itemType: string
  title: string
  scoreGroupId: string
  maxEntries: number | null
  sortOrder: number
  status: 'active' | 'voided'
  currentRevisionId: string | null
  createdAt: number
}

const itemColumns = [
  'id',
  'batchId',
  'itemType',
  'title',
  'scoreGroupId',
  'maxEntries',
  'sortOrder',
  'status',
  'currentRevisionId',
] as const

const toItem = (row: Record<string, unknown>): ItemRow => ({
  id: String(row['id']),
  batchId: String(row['batchId']),
  itemType: String(row['itemType']),
  title: String(row['title']),
  scoreGroupId: String(row['scoreGroupId']),
  maxEntries: row['maxEntries'] == null ? null : Number(row['maxEntries']),
  sortOrder: Number(row['sortOrder']),
  status: String(row['status']) as ItemRow['status'],
  currentRevisionId: row['currentRevisionId'] == null ? null : String(row['currentRevisionId']),
  createdAt: msOf(row['createdMs']),
})

export const itemsOf = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AssessmentItem')
        .select(itemColumns)
        .select([epoch('created_at').as('createdMs')])
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .orderBy('sortOrder')
        .orderBy('createdAt')
        .orderBy('id')
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => toItem(row as Record<string, unknown>))))

export const itemOf = (tenantId: string, itemId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AssessmentItem')
        .select(itemColumns)
        .select([epoch('created_at').as('createdMs')])
        .where('tenantId', '=', tenantId)
        .where('id', '=', itemId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ? toItem(row as Record<string, unknown>) : null)))

export const insertItem = (input: {
  tenantId: string
  batchId: string
  itemType: string
  title: string
  scoreGroupId: string
  maxEntries: number | null
  sortOrder: number
}) =>
  db
    .query((k) =>
      k
        .insertInto('AssessmentItem')
        .values({
          tenantId: input.tenantId,
          batchId: input.batchId,
          itemType: input.itemType,
          title: input.title,
          scoreGroupId: input.scoreGroupId,
          maxEntries: input.maxEntries,
          sortOrder: input.sortOrder,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => String((row as { id: unknown }).id)))

export const updateItemFields = (input: {
  tenantId: string
  itemId: string
  fields: {
    title?: string
    scoreGroupId?: string
    maxEntries?: number | null
    sortOrder?: number
  }
}) =>
  db.query((k) =>
    k
      .updateTable('AssessmentItem')
      .set({
        ...(input.fields.title !== undefined ? { title: input.fields.title } : {}),
        ...(input.fields.scoreGroupId !== undefined
          ? { scoreGroupId: input.fields.scoreGroupId }
          : {}),
        ...(input.fields.maxEntries !== undefined ? { maxEntries: input.fields.maxEntries } : {}),
        ...(input.fields.sortOrder !== undefined ? { sortOrder: input.fields.sortOrder } : {}),
        updatedAt: sql`now()`,
      })
      .where('tenantId', '=', input.tenantId)
      .where('id', '=', input.itemId)
      .execute(),
  )

const revisionColumns = [
  'id',
  'revisionNo',
  'entrySource',
  'formConfig',
  'scoringConfig',
  'reviewPolicy',
  'displayConfig',
  'createdBy',
  'reason',
] as const

const toRevision = (row: Record<string, unknown>): ItemRevisionRow => ({
  id: String(row['id']),
  revisionNo: Number(row['revisionNo']),
  entrySource: String(row['entrySource']) as ItemRevisionRow['entrySource'],
  formConfig: row['formConfig'],
  scoringConfig: row['scoringConfig'],
  reviewPolicy: row['reviewPolicy'],
  displayConfig: row['displayConfig'],
  createdBy: String(row['createdBy']),
  reason: row['reason'] == null ? null : String(row['reason']),
  createdAt: msOf(row['createdMs']),
})

export const revisionOf = (tenantId: string, revisionId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AssessmentItemRevision')
        .select(revisionColumns)
        .select([epoch('created_at').as('createdMs')])
        .where('tenantId', '=', tenantId)
        .where('id', '=', revisionId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ? toRevision(row as Record<string, unknown>) : null)))

export const revisionsOf = (tenantId: string, itemIds: readonly string[]) =>
  itemIds.length === 0
    ? Effect.succeed(new Map<string, ItemRevisionRow>())
    : db
        .query((k) =>
          k
            .selectFrom('AssessmentItemRevision')
            .select(revisionColumns)
            .select(['itemId'])
            .select([epoch('created_at').as('createdMs')])
            .where('tenantId', '=', tenantId)
            .where('id', 'in', (qb) =>
              qb
                .selectFrom('AssessmentItem')
                .select('currentRevisionId')
                .where('tenantId', '=', tenantId)
                .where('id', 'in', [...itemIds])
                .where('currentRevisionId', 'is not', null),
            )
            .execute(),
        )
        .pipe(
          Effect.map(
            (rows) =>
              new Map(
                rows.map((row) => [
                  String((row as Record<string, unknown>)['itemId']),
                  toRevision(row as Record<string, unknown>),
                ]),
              ),
          ),
        )

export const insertItemRevision = (input: {
  tenantId: string
  itemId: string
  revisionNo: number
  entrySource: 'student' | 'administrative'
  formConfig: unknown
  scoringConfig: unknown
  reviewPolicy: unknown
  displayConfig: unknown
  createdBy: string
  reason: string | null
}) =>
  db
    .query((k) =>
      k
        .insertInto('AssessmentItemRevision')
        .values({
          tenantId: input.tenantId,
          itemId: input.itemId,
          revisionNo: input.revisionNo,
          entrySource: input.entrySource,
          formConfig: jsonb(input.formConfig),
          scoringConfig: jsonb(input.scoringConfig),
          reviewPolicy: jsonb(input.reviewPolicy),
          displayConfig: jsonb(input.displayConfig),
          createdBy: input.createdBy,
          reason: input.reason,
        } as never)
        .returning(['id'])
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => String((row as { id: unknown }).id)))

export const nextRevisionNo = (tenantId: string, itemId: string) =>
  db
    .query((k) =>
      sql<{ next: string }>`
        select coalesce(max(revision_no), 0) + 1 as next
        from assessment_item_revisions
        where tenant_id = ${tenantId} and item_id = ${itemId}
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => Number(rows[0]!.next)))

export const setCurrentRevision = (tenantId: string, itemId: string, revisionId: string) =>
  db.query((k) =>
    k
      .updateTable('AssessmentItem')
      .set({ currentRevisionId: revisionId, updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', itemId)
      .execute(),
  )

/** whether any entry, in any state, has ever been filed against this item */
export const itemHasEntries = (tenantId: string, itemId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('itemId', '=', itemId)
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/** every active item's current configuration, for the range impact check */
export const currentBatchConfigs = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AssessmentItem')
        .innerJoin('AssessmentItemRevision', (join) =>
          join
            .onRef('AssessmentItemRevision.tenantId', '=', 'AssessmentItem.tenantId')
            .onRef('AssessmentItemRevision.id', '=', 'AssessmentItem.currentRevisionId'),
        )
        .select([
          'AssessmentItem.id as itemId',
          'AssessmentItem.itemType as itemType',
          'AssessmentItemRevision.formConfig as formConfig',
        ])
        .where('AssessmentItem.tenantId', '=', tenantId)
        .where('AssessmentItem.batchId', '=', batchId)
        .where('AssessmentItem.status', '=', 'active')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => {
          const record = row as Record<string, unknown>
          return {
            itemId: String(record['itemId']),
            itemType: String(record['itemType']),
            formConfig: record['formConfig'],
          }
        }),
      ),
    )

/**
 * Every live entry of a batch with what its payload decodes by, for the
 * material-range impact check: each row carries its own item revision's form
 * and its item's driver, because history decodes by what it cited, never by
 * what the item says today.
 */
export const liveBatchPayloads = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry')
        .innerJoin('EntryRevision', (join) =>
          join
            .onRef('EntryRevision.tenantId', '=', 'Entry.tenantId')
            .onRef('EntryRevision.id', '=', 'Entry.currentRevisionId'),
        )
        .innerJoin('AssessmentItemRevision', (join) =>
          join
            .onRef('AssessmentItemRevision.tenantId', '=', 'Entry.tenantId')
            .onRef('AssessmentItemRevision.id', '=', 'EntryRevision.itemRevisionId'),
        )
        .innerJoin('AssessmentItem', (join) =>
          join
            .onRef('AssessmentItem.tenantId', '=', 'Entry.tenantId')
            .onRef('AssessmentItem.id', '=', 'Entry.itemId'),
        )
        .select([
          'Entry.id as entryId',
          'Entry.itemId as itemId',
          'AssessmentItem.itemType as itemType',
          'AssessmentItemRevision.formConfig as formConfig',
          'EntryRevision.payload as payload',
        ])
        .where('Entry.tenantId', '=', tenantId)
        .where('Entry.batchId', '=', batchId)
        .where('Entry.status', 'in', ['in_review', 'approved'])
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => {
          const record = row as Record<string, unknown>
          return {
            entryId: String(record['entryId']),
            itemId: String(record['itemId']),
            itemType: String(record['itemType']),
            formConfig: record['formConfig'],
            payload: record['payload'],
          }
        }),
      ),
    )

/**
 * The revisions a configuration change must still be able to read: the
 * current revision of every entry of this item that is in review or approved.
 *
 * Draft and rejected entries are absent on purpose - they re-enter through
 * the new form, so the new configuration owes them nothing.
 */
export const liveEntryPayloads = (tenantId: string, itemId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry')
        .innerJoin('EntryRevision', (join) =>
          join
            .onRef('EntryRevision.tenantId', '=', 'Entry.tenantId')
            .onRef('EntryRevision.id', '=', 'Entry.currentRevisionId'),
        )
        .select(['Entry.id as entryId', 'EntryRevision.payload as payload'])
        .where('Entry.tenantId', '=', tenantId)
        .where('Entry.itemId', '=', itemId)
        .where('Entry.status', 'in', ['in_review', 'approved'])
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          entryId: String((row as Record<string, unknown>)['entryId']),
          payload: (row as Record<string, unknown>)['payload'],
        })),
      ),
    )

/**
 * A draft-batch question leaves without ceremony: the projection lets go of
 * its revision, the revisions go, the row goes. Only callable where nothing
 * ever happened - the service refuses when any entry exists.
 */
export const deleteItemRows = (tenantId: string, itemId: string) =>
  Effect.gen(function* () {
    yield* db.query((k) =>
      k
        .updateTable('AssessmentItem')
        .set({ currentRevisionId: null })
        .where('tenantId', '=', tenantId)
        .where('id', '=', itemId)
        .execute(),
    )
    yield* db.query((k) =>
      k
        .deleteFrom('AssessmentItemRevision')
        .where('tenantId', '=', tenantId)
        .where('itemId', '=', itemId)
        .execute(),
    )
    yield* db.query((k) =>
      k
        .deleteFrom('AssessmentItem')
        .where('tenantId', '=', tenantId)
        .where('id', '=', itemId)
        .execute(),
    )
  })

/** active -> voided with its record, or voided -> active clean; CAS on the from-status */
export const setItemLifecycle = (
  input:
    | { tenantId: string; itemId: string; to: 'voided'; actorId: string; reason: string }
    | { tenantId: string; itemId: string; to: 'active' },
) =>
  db
    .query((k) =>
      k
        .updateTable('AssessmentItem')
        .set(
          input.to === 'voided'
            ? {
                status: 'voided',
                voidedAt: sql`now()`,
                voidedBy: input.actorId,
                voidReason: input.reason,
                updatedAt: sql`now()`,
              }
            : {
                status: 'active',
                voidedAt: null,
                voidedBy: null,
                voidReason: null,
                updatedAt: sql`now()`,
              },
        )
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.itemId)
        .where('status', '=', input.to === 'voided' ? 'active' : 'voided')
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))
