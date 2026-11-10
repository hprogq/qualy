import { Effect } from 'effect'
import { db } from '../server/db.ts'

/** Exact frozen revision, after the caller has authorized the sibling business object. */
export const siblingFileIds = (tenantId: string, entryId: string, revisionNo: number) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRevisionAttachment as era')
        .innerJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'era.tenantId').onRef('er.id', '=', 'era.revisionId'),
        )
        .select('era.attachmentId')
        .where('era.tenantId', '=', tenantId)
        .where('er.entryId', '=', entryId)
        .where('er.revisionNo', '=', revisionNo)
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.attachmentId)))
