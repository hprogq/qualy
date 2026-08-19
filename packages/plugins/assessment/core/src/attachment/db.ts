import { Effect } from 'effect'
import { db } from '../server/db.ts'
import { OPEN_REVIEW_STATES } from '../review/db.ts'

// Who stands around an attachment: every entry whose history cites it, and
// every review round that judged a revision citing it. The authorizer walks
// these to decide whether a reader belongs to the file's story.

export interface CitingEntryRow {
  entryId: string
  batchId: string
  subjectUserId: string
}

export const citingEntries = (tenantId: string, attachmentId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRevisionAttachment as era')
        .innerJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'era.tenantId').onRef('er.id', '=', 'era.revisionId'),
        )
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'er.tenantId').onRef('e.id', '=', 'er.entryId'),
        )
        .innerJoin('BatchParticipant as bp', (join) =>
          join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
        )
        .select(['e.id as entryId', 'e.batchId', 'bp.userId as subjectUserId'])
        .distinct()
        .where('era.tenantId', '=', tenantId)
        .where('era.attachmentId', '=', attachmentId)
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): CitingEntryRow => ({
          entryId: row.entryId,
          batchId: row.batchId,
          subjectUserId: row.subjectUserId,
        })),
      ),
    )

export interface CitingInstanceRow {
  batchId: string
  currentNodeId: string
  currentRoleIds: readonly string[]
  subjectUserId: string
  actorId: string
}

/** the entries whose supplement answers cite this file, same shape as above */
export const supplementCitingEntries = (tenantId: string, attachmentId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewSupplementAttachment as rsa')
        .innerJoin('ReviewSupplementResponse as re', (join) =>
          join.onRef('re.tenantId', '=', 'rsa.tenantId').onRef('re.id', '=', 'rsa.responseId'),
        )
        .innerJoin('ReviewSupplementRequest as sr', (join) =>
          join.onRef('sr.tenantId', '=', 're.tenantId').onRef('sr.id', '=', 're.requestId'),
        )
        .innerJoin('ReviewInstance as ri', (join) =>
          join.onRef('ri.tenantId', '=', 'sr.tenantId').onRef('ri.id', '=', 'sr.reviewInstanceId'),
        )
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .innerJoin('BatchParticipant as bp', (join) =>
          join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
        )
        .select(['e.id as entryId', 'e.batchId', 'bp.userId as subjectUserId'])
        .distinct()
        .where('rsa.tenantId', '=', tenantId)
        .where('rsa.attachmentId', '=', attachmentId)
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): CitingEntryRow => ({
          entryId: row.entryId,
          batchId: row.batchId,
          subjectUserId: row.subjectUserId,
        })),
      ),
    )

/** the rounds that judged a revision citing this file, shaped for the reviewer predicate */
export const citingInstances = (tenantId: string, attachmentId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .innerJoin('EntryRevisionAttachment as era', (join) =>
          join
            .onRef('era.tenantId', '=', 'ri.tenantId')
            .onRef('era.revisionId', '=', 'ri.revisionId'),
        )
        .innerJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
        )
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .innerJoin('BatchParticipant as bp', (join) =>
          join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
        )
        .select([
          'e.batchId',
          'ri.currentNodeId',
          'ri.currentRoleIds',
          'bp.userId as subjectUserId',
          'er.actorId',
        ])
        .distinct()
        .where('ri.tenantId', '=', tenantId)
        .where('era.attachmentId', '=', attachmentId)
        // only rounds that still have reviewers: a decided round's last
        // stage must not keep handing its people the files
        .where('ri.state', 'in', [...OPEN_REVIEW_STATES])
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): CitingInstanceRow => ({
          batchId: row.batchId,
          currentNodeId: row.currentNodeId,
          currentRoleIds: row.currentRoleIds,
          subjectUserId: row.subjectUserId,
          actorId: row.actorId,
        })),
      ),
    )

/** the rounds whose supplement answers cite this file, same shape as above */
export const supplementCitingInstances = (tenantId: string, attachmentId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewSupplementAttachment as rsa')
        .innerJoin('ReviewSupplementResponse as re', (join) =>
          join.onRef('re.tenantId', '=', 'rsa.tenantId').onRef('re.id', '=', 'rsa.responseId'),
        )
        .innerJoin('ReviewSupplementRequest as sr', (join) =>
          join.onRef('sr.tenantId', '=', 're.tenantId').onRef('sr.id', '=', 're.requestId'),
        )
        .innerJoin('ReviewInstance as ri', (join) =>
          join.onRef('ri.tenantId', '=', 'sr.tenantId').onRef('ri.id', '=', 'sr.reviewInstanceId'),
        )
        .innerJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
        )
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .innerJoin('BatchParticipant as bp', (join) =>
          join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
        )
        .select([
          'e.batchId',
          'ri.currentNodeId',
          'ri.currentRoleIds',
          'bp.userId as subjectUserId',
          'er.actorId',
        ])
        .distinct()
        .where('rsa.tenantId', '=', tenantId)
        .where('rsa.attachmentId', '=', attachmentId)
        // the same boundary as the revision-cited rounds above
        .where('ri.state', 'in', [...OPEN_REVIEW_STATES])
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): CitingInstanceRow => ({
          batchId: row.batchId,
          currentNodeId: row.currentNodeId,
          currentRoleIds: row.currentRoleIds,
          subjectUserId: row.subjectUserId,
          actorId: row.actorId,
        })),
      ),
    )
