import { Effect } from 'effect'
import { db } from '../server/db.ts'

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
