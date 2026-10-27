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
  /**
   * Cited by a version that was handed in: the last one or an earlier one.
   * A file only the owner's working version cites is still on their desk
   * (ruling of 2026-09-29), and reads to nobody else until it is sent.
   */
  handedIn: boolean
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
        .leftJoin('EntryRevision as handed', (join) =>
          join
            .onRef('handed.tenantId', '=', 'e.tenantId')
            .onRef('handed.id', '=', 'e.lastSubmittedRevisionId'),
        )
        .select(['e.id as entryId', 'e.batchId', 'bp.userId as subjectUserId'])
        // null where nothing was ever handed in, which reads as false below
        .select((eb) => eb('er.revisionNo', '<=', eb.ref('handed.revisionNo')).as('handedIn'))
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
          handedIn: row.handedIn === true,
        })),
      ),
    )

export interface CitingInstanceRow {
  id: string
  batchId: string
  /** the authorizer needs it: a reviewer's read narrows while an ask is open (§32.70) */
  state: string
  currentRoute: 'normal' | 'escalation'
  currentNodeId: string | null
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
          // an answer is given on a round, to a claim already handed in
          handedIn: true,
        })),
      ),
    )

/**
 * The open rounds of a claim that cited this file in any version up to the
 * one last handed in, shaped for the reviewer predicate: the history a
 * round's reader is shown (getEntryHistory) carries its files with it, a file
 * removed in a later version included. A version still on the owner's desk is
 * not history yet, and its files stay theirs.
 */
export const citingInstances = (tenantId: string, attachmentId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .innerJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
        )
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .innerJoin('EntryRevision as handed', (join) =>
          join
            .onRef('handed.tenantId', '=', 'e.tenantId')
            .onRef('handed.id', '=', 'e.lastSubmittedRevisionId'),
        )
        .innerJoin('EntryRevision as cited', (join) =>
          join
            .onRef('cited.tenantId', '=', 'e.tenantId')
            .onRef('cited.entryId', '=', 'e.id')
            .onRef('cited.revisionNo', '<=', 'handed.revisionNo'),
        )
        .innerJoin('EntryRevisionAttachment as era', (join) =>
          join
            .onRef('era.tenantId', '=', 'cited.tenantId')
            .onRef('era.revisionId', '=', 'cited.id'),
        )
        .innerJoin('BatchParticipant as bp', (join) =>
          join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
        )
        .select([
          'ri.id',
          'e.batchId',
          'ri.state',
          'ri.currentRoute',
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
          id: row.id,
          batchId: row.batchId,
          state: row.state,
          currentRoute: row.currentRoute as CitingInstanceRow['currentRoute'],
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
          'ri.id',
          'e.batchId',
          'ri.state',
          'ri.currentRoute',
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
          id: row.id,
          batchId: row.batchId,
          state: row.state,
          currentRoute: row.currentRoute as CitingInstanceRow['currentRoute'],
          currentNodeId: row.currentNodeId,
          currentRoleIds: row.currentRoleIds,
          subjectUserId: row.subjectUserId,
          actorId: row.actorId,
        })),
      ),
    )

/**
 * The open rounds on a claim beside one that cites this file: same
 * participant, same question. A reviewer compares the claims a person holds
 * on one question to catch a duplicate, so the round's reader reads the
 * others' files too - only as last handed in, and only for claims still
 * standing (not drafts, not voided), which is what the sibling strip lists.
 */
export const peerCitingInstances = (tenantId: string, attachmentId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRevisionAttachment as era')
        .innerJoin('Entry as cited', (join) =>
          join
            .onRef('cited.tenantId', '=', 'era.tenantId')
            .onRef('cited.lastSubmittedRevisionId', '=', 'era.revisionId'),
        )
        .innerJoin('Entry as peer', (join) =>
          join
            .onRef('peer.tenantId', '=', 'cited.tenantId')
            .onRef('peer.itemId', '=', 'cited.itemId')
            .onRef('peer.participantId', '=', 'cited.participantId'),
        )
        .innerJoin('ReviewInstance as ri', (join) =>
          join.onRef('ri.tenantId', '=', 'peer.tenantId').onRef('ri.entryId', '=', 'peer.id'),
        )
        .innerJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
        )
        .innerJoin('BatchParticipant as bp', (join) =>
          join.onRef('bp.tenantId', '=', 'peer.tenantId').onRef('bp.id', '=', 'peer.participantId'),
        )
        .select([
          'ri.id',
          'peer.batchId',
          'ri.state',
          'ri.currentRoute',
          'ri.currentNodeId',
          'ri.currentRoleIds',
          'bp.userId as subjectUserId',
          'er.actorId',
        ])
        .distinct()
        .where('era.tenantId', '=', tenantId)
        .where('era.attachmentId', '=', attachmentId)
        .where('cited.status', 'not in', ['voided', 'draft'])
        .whereRef('peer.id', '!=', 'cited.id')
        .where('ri.state', 'in', [...OPEN_REVIEW_STATES])
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): CitingInstanceRow => ({
          id: row.id,
          batchId: row.batchId,
          state: row.state,
          currentRoute: row.currentRoute as CitingInstanceRow['currentRoute'],
          currentNodeId: row.currentNodeId,
          currentRoleIds: row.currentRoleIds,
          subjectUserId: row.subjectUserId,
          actorId: row.actorId,
        })),
      ),
    )
