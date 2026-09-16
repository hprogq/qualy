import { Effect } from 'effect'
import { sql } from 'kysely'
import { db, staffReachOver } from '../server/db.ts'

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
  readonly sourceAttachmentId: string | null
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
  sourceAttachmentId:
    row['sourceAttachmentId'] == null ? null : String(row['sourceAttachmentId']),
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

/** every claim one import created, with where it currently stands */
export const entriesOfImport = (tenantId: string, importId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AdministrativeEntryImportRow as r')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'r.tenantId').onRef('e.id', '=', 'r.entryId'),
        )
        .select([
          'r.sourceRowNo',
          'r.entryId',
          'r.participantId',
          'r.businessNoSnapshot',
          'r.displayNameSnapshot',
          'e.status',
        ])
        .where('r.tenantId', '=', tenantId)
        .where('r.importId', '=', importId)
        .orderBy('r.sourceRowNo')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        (rows as unknown as Record<string, unknown>[]).map((row) => ({
          sourceRowNo: Number(row['sourceRowNo'] ?? 0),
          entryId: String(row['entryId']),
          participantId: String(row['participantId']),
          businessNoSnapshot:
            row['businessNoSnapshot'] == null ? null : String(row['businessNoSnapshot']),
          displayNameSnapshot:
            row['displayNameSnapshot'] == null ? null : String(row['displayNameSnapshot']),
          status: String(row['status']),
        })),
      ),
    )

/** the imports of one round, newest first, keyset-paged */
export const importsOfBatchPage = (input: {
  tenantId: string
  batchId: string
  /**
   * The conservative rule for somebody here on recording authority alone:
   * only imports they made, and only while every person in them is still
   * someone they may record on. A file of names is a list of people, and
   * having uploaded it once is not a standing licence to read it after the
   * reach that justified it has been taken away.
   */
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
        const reader = input.reader
        query = query.where('i.actorId', '=', reader.userId).where(
          // not one person in it outside the reader's current reach
          sql<boolean>`not exists (
            select 1
              from administrative_entry_import_rows r
              join batch_participants p
                on p.tenant_id = r.tenant_id and p.id = r.participant_id
             where r.tenant_id = i.tenant_id
               and r.import_id = i.id
               and not ${staffReachOver({
                 tenantId: input.tenantId,
                 batchId: input.batchId,
                 userId: reader.userId,
                 permissionCode: 'assessment.entry.record',
                 anchorNodeId: sql.ref('p.assessment_anchor_node_id'),
                 anchorPath: sql.ref('p.anchor_path'),
               })}
          )`,
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
