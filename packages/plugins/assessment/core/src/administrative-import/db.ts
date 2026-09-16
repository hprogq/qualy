import { Effect } from 'effect'
import { sql } from 'kysely'
import { db, staffReachOver } from '../server/db.ts'
import type { EntryStatus } from '../entry/db.ts'

// The reads a bulk administrative act needs, each of them one statement.
//
// A workbook of two thousand rows is two thousand chances to write a loop
// that asks the database once per row. Everything here is shaped the other
// way round: the whole set goes in, the whole answer comes back.

const epoch = (column: string) =>
  sql<number | null>`(extract(epoch from ${sql.ref(column)}) * 1000)::float8`

const msOf = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(value ?? 0)

export interface ResolvedImportParticipant {
  readonly businessNo: string
  readonly participantId: string
  readonly userId: string
  readonly displayName: string
}

/**
 * Which of these business numbers name somebody this caller may record on.
 *
 * One statement, and deliberately no way to tell the three refusals apart:
 * a number that names nobody, a number that names somebody excluded from
 * this round, and a number that names somebody outside the caller's reach
 * all come back the same way - absent. Otherwise the import door is a
 * directory of everybody else's students, readable a spreadsheet at a time.
 */
export const resolveImportParticipants = (input: {
  tenantId: string
  batchId: string
  actorId: string
  businessNos: readonly string[]
}) =>
  input.businessNos.length === 0
    ? Effect.succeed([] as readonly ResolvedImportParticipant[])
    : db
        .query((k) =>
          k
            .selectFrom('BatchParticipant as p')
            .innerJoin('User as u', (join) =>
              join.onRef('u.tenantId', '=', 'p.tenantId').onRef('u.id', '=', 'p.userId'),
            )
            .select([
              'p.id as participantId',
              'p.userId',
              'u.displayName',
              'u.businessNo',
            ])
            .where('p.tenantId', '=', input.tenantId)
            .where('p.batchId', '=', input.batchId)
            .where('p.status', '=', 'active')
            .where('u.businessNo', 'in', [...input.businessNos])
            .where(
              staffReachOver({
                tenantId: input.tenantId,
                batchId: input.batchId,
                userId: input.actorId,
                permissionCode: 'assessment.entry.record',
                anchorNodeId: sql.ref('p.assessment_anchor_node_id'),
                anchorPath: sql.ref('p.anchor_path'),
              }),
            )
            .execute(),
        )
        .pipe(
          Effect.map((rows) =>
            (rows as unknown as Record<string, unknown>[]).map(
              (row): ResolvedImportParticipant => ({
                businessNo: String(row['businessNo']),
                participantId: String(row['participantId']),
                userId: String(row['userId']),
                displayName: String(row['displayName'] ?? ''),
              }),
            ),
          ),
        )

/**
 * How many effective claims each of these people already has on a question.
 *
 * One aggregate rather than a count per row, and voided claims are not in
 * it - a withdrawn fact does not hold a place, which is what makes "void
 * and record again" a correction rather than a dead end.
 */
export const effectiveEntryCounts = (input: {
  tenantId: string
  itemId: string
  participantIds: readonly string[]
}) =>
  input.participantIds.length === 0
    ? Effect.succeed(new Map<string, number>())
    : db
        .query((k) =>
          k
            .selectFrom('Entry')
            .select(['participantId'])
            .select([sql<number>`count(*)::int`.as('held')])
            .where('tenantId', '=', input.tenantId)
            .where('itemId', '=', input.itemId)
            .where('status', '<>', 'voided')
            .where('participantId', 'in', [...input.participantIds])
            .groupBy('participantId')
            .execute(),
        )
        .pipe(
          Effect.map(
            (rows) =>
              new Map(
                (rows as unknown as Record<string, unknown>[]).map((row) => [
                  String(row['participantId']),
                  Number(row['held'] ?? 0),
                ]),
              ),
          ),
        )

export interface ImportRow {
  readonly id: string
  readonly tenantId: string
  readonly batchId: string
  readonly itemId: string
  readonly itemRevisionId: string
  readonly sourceAttachmentId: string
  readonly filenameSnapshot: string
  readonly sizeBytes: string
  readonly contentHashAlgorithm: string | null
  readonly contentHash: string | null
  readonly actorId: string | null
  readonly defaultBasis: string | null
  readonly importedCount: number
  readonly createdAt: number
}

export const insertImport = (input: {
  tenantId: string
  batchId: string
  itemId: string
  itemRevisionId: string
  sourceAttachmentId: string
  filenameSnapshot: string
  sizeBytes: string
  contentHashAlgorithm: string | null
  contentHash: string | null
  actorId: string
  defaultBasis: string | null
  importedCount: number
}) =>
  db
    .query((k) =>
      k
        .insertInto('AdministrativeEntryImport')
        .values({
          tenantId: input.tenantId,
          batchId: input.batchId,
          itemId: input.itemId,
          itemRevisionId: input.itemRevisionId,
          sourceAttachmentId: input.sourceAttachmentId,
          filenameSnapshot: input.filenameSnapshot,
          sizeBytes: input.sizeBytes,
          contentHashAlgorithm: input.contentHashAlgorithm,
          contentHash: input.contentHash,
          actorId: input.actorId,
          defaultBasis: input.defaultBasis,
          importedCount: input.importedCount,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => String((row as Record<string, unknown>)['id'])))

export const insertImportRows = (
  tenantId: string,
  importId: string,
  rows: readonly {
    sourceRowNo: number
    participantId: string
    entryId: string
    businessNoSnapshot: string | null
    displayNameSnapshot: string | null
  }[],
) =>
  rows.length === 0
    ? Effect.succeed(undefined)
    : db
        .query((k) =>
          k
            .insertInto('AdministrativeEntryImportRow')
            .values(rows.map((row) => ({ tenantId, importId, ...row })) as never)
            .execute(),
        )
        .pipe(Effect.asVoid)

export const insertImportEvent = (input: {
  tenantId: string
  importId: string
  kind: string
  actorId: string
  reason: string | null
  affectedCount: number
}) =>
  db
    .query((k) => k.insertInto('AdministrativeEntryImportEvent').values(input as never).execute())
    .pipe(Effect.asVoid)

export const importOf = (tenantId: string, importId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AdministrativeEntryImport')
        .selectAll()
        .select([epoch('created_at').as('createdMs')])
        .where('tenantId', '=', tenantId)
        .where('id', '=', importId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ? toImport(row as Record<string, unknown>) : null)))

const toImport = (row: Record<string, unknown>): ImportRow => ({
  id: String(row['id']),
  tenantId: String(row['tenantId']),
  batchId: String(row['batchId']),
  itemId: String(row['itemId']),
  itemRevisionId: String(row['itemRevisionId']),
  sourceAttachmentId: String(row['sourceAttachmentId']),
  filenameSnapshot: String(row['filenameSnapshot'] ?? ''),
  sizeBytes: String(row['sizeBytes'] ?? '0'),
  contentHashAlgorithm:
    row['contentHashAlgorithm'] == null ? null : String(row['contentHashAlgorithm']),
  contentHash: row['contentHash'] == null ? null : String(row['contentHash']),
  actorId: row['actorId'] == null ? null : String(row['actorId']),
  defaultBasis: row['defaultBasis'] == null ? null : String(row['defaultBasis']),
  importedCount: Number(row['importedCount'] ?? 0),
  createdAt: msOf(row['createdMs']),
})

export interface ImportStanding {
  readonly importId: string
  readonly approved: number
  readonly inReview: number
  readonly rejected: number
  readonly voided: number
  readonly other: number
}

/**
 * What each import currently comes to, counted when somebody asks.
 *
 * Never stored: a second copy of "how many are still in effect" is a second
 * copy that can drift, and the entries already answer it.
 */
export const standingOfImports = (tenantId: string, importIds: readonly string[]) =>
  importIds.length === 0
    ? Effect.succeed(new Map<string, ImportStanding>())
    : db
        .query((k) =>
          k
            .selectFrom('AdministrativeEntryImportRow as r')
            .innerJoin('Entry as e', (join) =>
              join.onRef('e.tenantId', '=', 'r.tenantId').onRef('e.id', '=', 'r.entryId'),
            )
            .select(['r.importId', 'e.status'])
            .select([sql<number>`count(*)::int`.as('held')])
            .where('r.tenantId', '=', tenantId)
            .where('r.importId', 'in', [...importIds])
            .groupBy(['r.importId', 'e.status'])
            .execute(),
        )
        .pipe(
          Effect.map((rows) => {
            const out = new Map<string, ImportStanding>()
            const blank = (importId: string): ImportStanding => ({
              importId,
              approved: 0,
              inReview: 0,
              rejected: 0,
              voided: 0,
              other: 0,
            })
            for (const raw of rows as unknown as Record<string, unknown>[]) {
              const importId = String(raw['importId'])
              const held = Number(raw['held'] ?? 0)
              const status = String(raw['status'])
              const current = out.get(importId) ?? blank(importId)
              const key =
                status === 'approved'
                  ? 'approved'
                  : status === 'in_review'
                    ? 'inReview'
                    : status === 'rejected'
                      ? 'rejected'
                      : status === 'voided'
                        ? 'voided'
                        : 'other'
              out.set(importId, { ...current, [key]: current[key] + held })
            }
            return out
          }),
        )

/**
 * Whether this reader may still look back on an import, as a predicate on
 * the import aliased `i`.
 *
 * The conservative rule for somebody here on recording authority: only
 * imports they made, and only while every person in them is still someone
 * they may record on. A file of names is a list of people, and having
 * uploaded it once is not a standing licence to read it after the reach
 * that justified it has been taken away. The list, the detail, its rows,
 * the original file and the reversal all ask this one question.
 */
const readableBy = (input: { tenantId: string; batchId: string; userId: string }) =>
  sql<boolean>`(
    i.actor_id = ${input.userId}
    and not exists (
      select 1
        from administrative_entry_import_rows r
        join batch_participants p
          on p.tenant_id = r.tenant_id and p.id = r.participant_id
       where r.tenant_id = i.tenant_id
         and r.import_id = i.id
         and not ${staffReachOver({
           tenantId: input.tenantId,
           batchId: input.batchId,
           userId: input.userId,
           permissionCode: 'assessment.entry.record',
           anchorNodeId: sql.ref('p.assessment_anchor_node_id'),
           anchorPath: sql.ref('p.anchor_path'),
         })}
    )
  )`

/** the readability rule above, for one import */
export const importReadable = (input: {
  tenantId: string
  batchId: string
  importId: string
  userId: string
}) =>
  db
    .query((k) =>
      k
        .selectFrom('AdministrativeEntryImport as i')
        .select(sql<number>`1`.as('one'))
        .where('i.tenantId', '=', input.tenantId)
        .where('i.id', '=', input.importId)
        .where(readableBy(input))
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export interface ImportDetailRow extends ImportRow {
  readonly itemTitle: string
  readonly itemRevisionNo: number
  readonly actorName: string | null
}

/** one import with the names a reader recognises it by */
export const importDetailOf = (tenantId: string, importId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AdministrativeEntryImport as i')
        .innerJoin('AssessmentItem as it', (join) =>
          join.onRef('it.tenantId', '=', 'i.tenantId').onRef('it.id', '=', 'i.itemId'),
        )
        .innerJoin('AssessmentItemRevision as v', (join) =>
          join.onRef('v.tenantId', '=', 'i.tenantId').onRef('v.id', '=', 'i.itemRevisionId'),
        )
        .leftJoin('User as a', (join) =>
          join.onRef('a.tenantId', '=', 'i.tenantId').onRef('a.id', '=', 'i.actorId'),
        )
        .selectAll('i')
        .select([
          'it.title as itemTitle',
          'v.revisionNo as itemRevisionNo',
          'a.displayName as actorName',
        ])
        .select([epoch('i.created_at').as('createdMs')])
        .where('i.tenantId', '=', tenantId)
        .where('i.id', '=', importId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row): ImportDetailRow | null => {
        if (row === undefined) return null
        const raw = row as Record<string, unknown>
        return {
          ...toImport(raw),
          itemTitle: String(raw['itemTitle'] ?? ''),
          itemRevisionNo: Number(raw['itemRevisionNo'] ?? 0),
          actorName: raw['actorName'] == null ? null : String(raw['actorName']),
        }
      }),
    )

/** what has been done to one import as a whole, oldest first */
export const eventsOfImport = (tenantId: string, importId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AdministrativeEntryImportEvent as ev')
        .leftJoin('User as a', (join) =>
          join.onRef('a.tenantId', '=', 'ev.tenantId').onRef('a.id', '=', 'ev.actorId'),
        )
        .select([
          'ev.id',
          'ev.kind',
          'ev.actorId',
          'ev.reason',
          'ev.affectedCount',
          'a.displayName as actorName',
        ])
        .select([epoch('ev.created_at').as('createdMs')])
        .where('ev.tenantId', '=', tenantId)
        .where('ev.importId', '=', importId)
        .orderBy(sql`ev.created_at`)
        .orderBy(sql`ev.id`)
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        (rows as unknown as Record<string, unknown>[]).map((row) => ({
          id: String(row['id']),
          kind: String(row['kind']),
          actorId: row['actorId'] == null ? null : String(row['actorId']),
          actorName: row['actorName'] == null ? null : String(row['actorName']),
          reason: row['reason'] == null ? null : String(row['reason']),
          affectedCount: Number(row['affectedCount'] ?? 0),
          createdAt: msOf(row['createdMs']),
        })),
      ),
    )

/** the rows of one import in the file's own order, keyset-paged on the row number */
export const importRowsPage = (input: {
  tenantId: string
  importId: string
  afterRowNo?: number | undefined
  limit: number
}) =>
  db
    .query((k) => {
      let query = k
        .selectFrom('AdministrativeEntryImportRow as r')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'r.tenantId').onRef('e.id', '=', 'r.entryId'),
        )
        .innerJoin('EntryRevision as v', (join) =>
          join.onRef('v.tenantId', '=', 'e.tenantId').onRef('v.id', '=', 'e.currentRevisionId'),
        )
        .innerJoin('BatchParticipant as p', (join) =>
          join.onRef('p.tenantId', '=', 'r.tenantId').onRef('p.id', '=', 'r.participantId'),
        )
        .innerJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'p.tenantId').onRef('u.id', '=', 'p.userId'),
        )
        .select([
          'r.sourceRowNo',
          'r.entryId',
          'r.participantId',
          'r.businessNoSnapshot',
          'r.displayNameSnapshot',
          'e.status',
          'v.itemRevisionId',
          'u.displayName',
          'u.businessNo',
        ])
        .where('r.tenantId', '=', input.tenantId)
        .where('r.importId', '=', input.importId)
      if (input.afterRowNo !== undefined) {
        query = query.where('r.sourceRowNo', '>', input.afterRowNo)
      }
      return query.orderBy('r.sourceRowNo').limit(input.limit).execute()
    })
    .pipe(
      Effect.map((rows) =>
        (rows as unknown as Record<string, unknown>[]).map((row) => ({
          rowNo: Number(row['sourceRowNo'] ?? 0),
          entryId: String(row['entryId']),
          participantId: String(row['participantId']),
          businessNoSnapshot:
            row['businessNoSnapshot'] == null ? null : String(row['businessNoSnapshot']),
          displayNameSnapshot:
            row['displayNameSnapshot'] == null ? null : String(row['displayNameSnapshot']),
          status: String(row['status']) as EntryStatus,
          itemRevisionId: String(row['itemRevisionId']),
          displayName: String(row['displayName'] ?? ''),
          businessNo: row['businessNo'] == null ? null : String(row['businessNo']),
        })),
      ),
    )

/**
 * Every fact one import created, with what a withdrawal needs to know about
 * each - and nothing found by participant and question. A fact recorded
 * again by hand after one of these was withdrawn is a different entry, and
 * reaching it through "the current claim for this person" would unmake a
 * correction.
 */
export const reversalCandidatesOf = (tenantId: string, importId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AdministrativeEntryImportRow as r')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'r.tenantId').onRef('e.id', '=', 'r.entryId'),
        )
        .innerJoin('BatchParticipant as p', (join) =>
          join.onRef('p.tenantId', '=', 'r.tenantId').onRef('p.id', '=', 'r.participantId'),
        )
        .select([
          'r.sourceRowNo',
          'r.entryId',
          'r.participantId',
          'p.userId as participantUserId',
          'e.status',
          'e.source',
          'e.currentReviewInstanceId',
        ])
        .where('r.tenantId', '=', tenantId)
        .where('r.importId', '=', importId)
        .orderBy('r.sourceRowNo')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        (rows as unknown as Record<string, unknown>[]).map((row) => ({
          rowNo: Number(row['sourceRowNo'] ?? 0),
          entryId: String(row['entryId']),
          participantId: String(row['participantId']),
          participantUserId: String(row['participantUserId']),
          status: String(row['status']) as EntryStatus,
          source: String(row['source']),
          currentReviewInstanceId:
            row['currentReviewInstanceId'] == null ? null : String(row['currentReviewInstanceId']),
        })),
      ),
    )

/** the imports of one round, newest first, keyset-paged */
export const importsOfBatchPage = (input: {
  tenantId: string
  batchId: string
  /** narrowed to what this reader may still look back on; see `readableBy` */
  reader?: { userId: string } | undefined
  after?: readonly [string, string] | undefined
  limit: number
}) =>
  db
    .query((k) => {
      let query = k
        .selectFrom('AdministrativeEntryImport as i')
        .innerJoin('AssessmentItem as it', (join) =>
          join.onRef('it.tenantId', '=', 'i.tenantId').onRef('it.id', '=', 'i.itemId'),
        )
        .leftJoin('User as a', (join) =>
          join.onRef('a.tenantId', '=', 'i.tenantId').onRef('a.id', '=', 'i.actorId'),
        )
        .select([
          'i.id',
          'i.itemId',
          'i.itemRevisionId',
          'i.filenameSnapshot',
          'i.importedCount',
          'i.defaultBasis',
          'i.actorId',
          'it.title as itemTitle',
          'a.displayName as actorName',
        ])
        .select([epoch('i.created_at').as('createdMs')])
        .select([sql<string>`i.created_at::text`.as('cursorAt')])
        .where('i.tenantId', '=', input.tenantId)
        .where('i.batchId', '=', input.batchId)
      if (input.reader !== undefined) {
        query = query.where(
          readableBy({ tenantId: input.tenantId, batchId: input.batchId, userId: input.reader.userId }),
        )
      }
      if (input.after !== undefined) {
        query = query.where(
          sql<boolean>`(i.created_at, i.id) < (${input.after[0]}::timestamptz, ${input.after[1]}::uuid)`,
        )
      }
      return query
        .orderBy(sql`i.created_at desc`)
        .orderBy(sql`i.id desc`)
        .limit(input.limit)
        .execute()
    })
    .pipe(
      Effect.map((rows) =>
        (rows as unknown as Record<string, unknown>[]).map((row) => ({
          id: String(row['id']),
          itemId: String(row['itemId']),
          itemRevisionId: String(row['itemRevisionId']),
          itemTitle: String(row['itemTitle'] ?? ''),
          filename: String(row['filenameSnapshot'] ?? ''),
          importedCount: Number(row['importedCount'] ?? 0),
          defaultBasis: row['defaultBasis'] == null ? null : String(row['defaultBasis']),
          actorId: row['actorId'] == null ? null : String(row['actorId']),
          actorName: row['actorName'] == null ? null : String(row['actorName']),
          createdAt: msOf(row['createdMs']),
          cursorAt: String(row['cursorAt']),
        })),
      ),
    )
