import { Effect } from 'effect'
import { sql } from 'kysely'
import { db, staffReachOver } from '../server/db.ts'
import type { EntryStatus } from '../entry/db.ts'

// What one bulk administrative act left behind.
//
// Provenance only: the finding, its determination and its basis all live on
// each entry's own revision, and a second copy here would be a second truth
// to keep in step. These answer one question - which facts were one act -
// and the rows are the only answer to it, because the selection that found
// the people is never resolved again (§32.78).

export const insertRecordOperation = (input: {
  tenantId: string
  batchId: string
  itemId: string
  itemRevisionId: string
  targetKind: 'people' | 'organization'
  targetSpec: Record<string, unknown>
  actorId: string
  recordedCount: number
}) =>
  db
    .query((k) =>
      k
        .insertInto('AdministrativeRecordOperation')
        .values(input as never)
        .returning('id')
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => String((row as Record<string, unknown>)['id'])))

export const insertRecordOperationRows = (
  tenantId: string,
  operationId: string,
  rows: readonly { participantId: string; entryId: string }[],
) =>
  rows.length === 0
    ? Effect.succeed(undefined)
    : db
        .query((k) =>
          k
            .insertInto('AdministrativeRecordOperationRow')
            .values(rows.map((row) => ({ tenantId, operationId, ...row })) as never)
            .execute(),
        )
        .pipe(Effect.asVoid)

export const insertRecordOperationEvent = (input: {
  tenantId: string
  operationId: string
  kind: string
  actorId: string
  reason: string | null
  affectedCount: number
}) =>
  db
    .query((k) =>
      k
        .insertInto('AdministrativeRecordOperationEvent')
        .values(input as never)
        .execute(),
    )
    .pipe(Effect.asVoid)

/** one act, or nothing if this tenant has no such act */
export const operationOf = (tenantId: string, operationId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AdministrativeRecordOperation')
        .select([
          'id',
          'batchId',
          'itemId',
          'itemRevisionId',
          'targetKind',
          'targetSpec',
          'actorId',
          'recordedCount',
        ])
        .select([sql<string>`created_at::text`.as('createdAt')])
        .where('tenantId', '=', tenantId)
        .where('id', '=', operationId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : {
              id: String((row as Record<string, unknown>)['id']),
              batchId: String((row as Record<string, unknown>)['batchId']),
              itemId: String((row as Record<string, unknown>)['itemId']),
              itemRevisionId: String((row as Record<string, unknown>)['itemRevisionId']),
              targetKind: String((row as Record<string, unknown>)['targetKind']),
              targetSpec: (row as Record<string, unknown>)['targetSpec'] as Record<string, unknown>,
              actorId:
                (row as Record<string, unknown>)['actorId'] == null
                  ? null
                  : String((row as Record<string, unknown>)['actorId']),
              recordedCount: Number((row as Record<string, unknown>)['recordedCount'] ?? 0),
              createdAt: String((row as Record<string, unknown>)['createdAt']),
            },
      ),
    )

/**
 * What this act produced and whether each of it can still be withdrawn.
 *
 * The frozen rows, never the selection that made them (§32.78): resolving
 * the units again would reach people who arrived afterwards and miss people
 * who have since moved away, which is the one failure the rows exist to
 * prevent. `reached` is the reader's own authority over each person, so a
 * withdrawal is judged by who is pressing rather than by who recorded.
 */
export const reversalCandidatesOfOperation = (
  tenantId: string,
  operationId: string,
  reader: { batchId: string; userId: string },
) =>
  db
    .query((k) =>
      k
        .selectFrom('AdministrativeRecordOperationRow as r')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'r.tenantId').onRef('e.id', '=', 'r.entryId'),
        )
        .innerJoin('BatchParticipant as p', (join) =>
          join.onRef('p.tenantId', '=', 'r.tenantId').onRef('p.id', '=', 'r.participantId'),
        )
        .select([
          'r.entryId',
          'r.participantId',
          'p.userId as participantUserId',
          'e.status',
          'e.source',
          'e.currentReviewInstanceId',
        ])
        .select(
          staffReachOver({
            tenantId,
            batchId: reader.batchId,
            userId: reader.userId,
            permissionCode: 'assessment.entry.record',
            anchorNodeId: sql.ref('p.assessment_anchor_node_id'),
            anchorPath: sql.ref('p.anchor_path'),
          }).as('reached'),
        )
        .where('r.tenantId', '=', tenantId)
        .where('r.operationId', '=', operationId)
        .orderBy('r.participantId')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        (rows as unknown as Record<string, unknown>[]).map((row) => ({
          entryId: String(row['entryId']),
          participantId: String(row['participantId']),
          participantUserId: String(row['participantUserId']),
          status: String(row['status']) as EntryStatus,
          source: String(row['source']),
          currentReviewInstanceId:
            row['currentReviewInstanceId'] == null ? null : String(row['currentReviewInstanceId']),
          reached: Boolean(row['reached']),
        })),
      ),
    )

/**
 * What each act comes to now, counted from its entries every time.
 *
 * Never stored: `recorded_count` is what the act wrote, and what is still
 * in effect is the entries' own status. Keeping a second number in step
 * with them is how the two come to disagree.
 */
export const standingOfOperations = (tenantId: string, operationIds: readonly string[]) =>
  operationIds.length === 0
    ? Effect.succeed(new Map<string, { voided: number }>())
    : db
        .query((k) =>
          k
            .selectFrom('AdministrativeRecordOperationRow as r')
            .innerJoin('Entry as e', (join) =>
              join.onRef('e.tenantId', '=', 'r.tenantId').onRef('e.id', '=', 'r.entryId'),
            )
            .select(['r.operationId'])
            .select([sql<number>`count(*) filter (where e.status = 'voided')::int`.as('voided')])
            .where('r.tenantId', '=', tenantId)
            .where('r.operationId', 'in', [...operationIds])
            .groupBy('r.operationId')
            .execute(),
        )
        .pipe(
          Effect.map(
            (rows) =>
              new Map(
                (rows as unknown as Record<string, unknown>[]).map((row) => [
                  String(row['operationId']),
                  { voided: Number(row['voided'] ?? 0) },
                ]),
              ),
          ),
        )

/** the acts of one round, newest first, keyset-paged */
export const operationsOfBatchPage = (input: {
  tenantId: string
  batchId: string
  after?: readonly [string, string] | undefined
  limit: number
}) =>
  db.query((k) => {
    let query = k
      .selectFrom('AdministrativeRecordOperation as o')
      .innerJoin('AssessmentItem as i', (join) =>
        join.onRef('i.tenantId', '=', 'o.tenantId').onRef('i.id', '=', 'o.itemId'),
      )
      .leftJoin('User as u', (join) =>
        join.onRef('u.tenantId', '=', 'o.tenantId').onRef('u.id', '=', 'o.actorId'),
      )
      .select([
        'o.id',
        'o.itemId',
        'o.targetKind',
        'o.targetSpec',
        'o.recordedCount',
        'i.title as itemTitle',
        'u.displayName as actorName',
      ])
      .select([sql<string>`o.created_at::text`.as('createdAt')])
      .where('o.tenantId', '=', input.tenantId)
      .where('o.batchId', '=', input.batchId)
    if (input.after !== undefined) {
      query = query.where(
        sql<boolean>`(o.created_at, o.id) < (${input.after[0]}::timestamptz, ${input.after[1]}::uuid)`,
      )
    }
    return query
      .orderBy(sql`o.created_at desc`)
      .orderBy(sql`o.id desc`)
      .limit(input.limit)
      .execute()
  })

/** what was done to a whole act, newest first */
export const eventsOfOperation = (tenantId: string, operationId: string) =>
  db.query((k) =>
    k
      .selectFrom('AdministrativeRecordOperationEvent as v')
      .leftJoin('User as u', (join) =>
        join.onRef('u.tenantId', '=', 'v.tenantId').onRef('u.id', '=', 'v.actorId'),
      )
      .select(['v.id', 'v.kind', 'v.reason', 'v.affectedCount', 'u.displayName as actorName'])
      .select([sql<string>`v.created_at::text`.as('createdAt')])
      .where('v.tenantId', '=', tenantId)
      .where('v.operationId', '=', operationId)
      .orderBy(sql`v.created_at desc`)
      .execute(),
  )

/** the act one fact came from, when it came from one */
export const operationOfEntry = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AdministrativeRecordOperationRow')
        .select(['operationId'])
        .where('tenantId', '=', tenantId)
        .where('entryId', '=', entryId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined ? null : String((row as Record<string, unknown>)['operationId']),
      ),
    )
