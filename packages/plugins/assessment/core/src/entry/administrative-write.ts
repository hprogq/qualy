import { Effect } from 'effect'
import { insertRecognition } from '../scoring/recognition-db.ts'
import {
  bumpParticipantAttention,
  cancelReviewInstance,
  insertEntry,
  insertEntryEvent,
  insertEntryRevision,
  insertReviewEvent,
  insertRevisionAttachments,
  setEntryState,
  type EntrySource,
  type EntryStatus,
} from './db.ts'

// Writing one administrative fact, inside a transaction somebody else opened.
//
// Both doors that write one - a member of staff recording, and a workbook
// being imported - come through here. Not to save typing: the order below is
// load-bearing, and two copies of it would drift. An entry is inserted as a
// draft because an approved one must already carry a determination and the
// determination needs the row's id; the status and the determination are
// then set in ONE statement, because the table refuses an approved entry
// without one.
//
// What this does NOT do is decide anything. Authority, reach, the phase
// gate, the payload's shape, whether the determination is provable - all of
// that is settled before the transaction opens, by whoever is calling. This
// only writes what it is handed, in the order the constraints require.

export interface AdministrativeWrite {
  readonly tenantId: string
  readonly batchId: string
  readonly itemId: string
  /** the question version this fact answers, frozen */
  readonly itemRevisionId: string
  readonly participantId: string
  /** the person it is about; never the person writing it */
  readonly subjectUserId: string
  readonly actorUserId: string
  readonly payload: unknown
  /** what the office determines by recording it, when the question asks */
  readonly recognition: Readonly<Record<string, unknown>> | undefined
  /** the document reference; an administrative fact is never written without one */
  readonly basis: string
  readonly source: Extract<EntrySource, 'record' | 'import'>
  readonly attachments: readonly { readonly attachmentId: string }[]
}

/**
 * The write, and the entry id it produced.
 *
 * The caller is responsible for having bound any attachments before calling:
 * binding takes its own locks and reads history, which is the caller's
 * transaction's business rather than this statement sequence's.
 */
export const recordAdministrativeEntryTx = (input: AdministrativeWrite) =>
  Effect.gen(function* () {
    const entryId = yield* insertEntry({
      tenantId: input.tenantId,
      batchId: input.batchId,
      itemId: input.itemId,
      participantId: input.participantId,
      source: input.source,
      status: 'draft',
    })
    const revisionId = yield* insertEntryRevision({
      tenantId: input.tenantId,
      entryId,
      itemId: input.itemId,
      itemRevisionId: input.itemRevisionId,
      revisionNo: 1,
      payload: input.payload,
      actorId: input.actorUserId,
      subjectId: input.subjectUserId,
      source: input.source,
      note: input.basis.trim() || null,
    })
    yield* insertRevisionAttachments(
      input.tenantId,
      revisionId,
      input.attachments.map((ref, position) => ({ attachmentId: ref.attachmentId, position })),
    )
    const recognitionId =
      input.recognition === undefined
        ? undefined
        : yield* insertRecognition({
            tenantId: input.tenantId,
            batchId: input.batchId,
            entryId,
            entryRevisionId: revisionId,
            itemId: input.itemId,
            itemRevisionId: input.itemRevisionId,
            values: input.recognition,
            // the provenance of the determination is the provenance of the
            // fact: a record's determination is a record's, an import's is an
            // import's, and a row that says one on the entry and the other on
            // the recognition has split its own history
            source: input.source,
            createdBy: input.actorUserId,
          })
    yield* setEntryState({
      tenantId: input.tenantId,
      entryId,
      from: ['draft'],
      to: 'approved',
      currentRevisionId: revisionId,
      ...(recognitionId === undefined ? {} : { currentRecognitionId: recognitionId }),
    })
    // a fact somebody else just added to their account is exactly what the
    // unread marker exists for: the broadcast reaches whoever is looking,
    // this reaches whoever is not. Per entry even in bulk, because it is
    // durable state on the owner's own row rather than a notification.
    yield* bumpParticipantAttention(input.tenantId, entryId)
    return { entryId, revisionId }
  })

/**
 * Withdrawing one administrative fact, inside a transaction somebody else
 * opened: the single withdrawal and the withdrawal of a whole import both
 * come through here.
 *
 * The determination stays exactly as written. The office is not saying it
 * never decided, it is saying the fact no longer applies, and the scorer
 * stops counting it because the claim is no longer effective. An appeal
 * still open against it closes first, and its sitting dissolves with it;
 * left open, the withdrawn fact would go on sitting in reviewers' queues.
 *
 * Decides nothing about who may do this. It answers only whether the entry
 * was still in a state a withdrawal can move, and the caller turns a `false`
 * into its own refusal - which fails the transaction, so an appeal closed a
 * moment earlier is taken back with it.
 */
export const voidAdministrativeEntryTx = (input: {
  readonly tenantId: string
  readonly entryId: string
  readonly status: EntryStatus
  readonly currentReviewInstanceId: string | null
  readonly actorUserId: string
  readonly reason: string
}) =>
  Effect.gen(function* () {
    if (input.status === 'voided') return { voided: false } as const
    let cancelledReview = false
    if (input.status === 'in_review') {
      if (input.currentReviewInstanceId === null) return { voided: false } as const
      const closed = yield* cancelReviewInstance({
        tenantId: input.tenantId,
        instanceId: input.currentReviewInstanceId,
        outcome: 'cancelled',
      })
      if (!closed) return { voided: false } as const
      yield* insertReviewEvent({
        tenantId: input.tenantId,
        reviewInstanceId: input.currentReviewInstanceId,
        kind: 'cancelled-by-staff',
        actorId: input.actorUserId,
        comment: input.reason,
      })
      cancelledReview = true
    }
    const gone = yield* setEntryState({
      tenantId: input.tenantId,
      entryId: input.entryId,
      from: ['draft', 'rejected', 'needs_revision', 'in_review', 'approved'],
      to: 'voided',
      ...(input.status === 'in_review' ? { currentReviewInstanceId: null } : {}),
    })
    if (!gone) return { voided: false } as const
    yield* insertEntryEvent({
      tenantId: input.tenantId,
      entryId: input.entryId,
      kind: 'voided-by-staff',
      actorId: input.actorUserId,
      reason: input.reason,
    })
    // their effective facts and their score just changed under them; the
    // persistent marker is what an offline participant comes back to
    yield* bumpParticipantAttention(input.tenantId, input.entryId)
    return { voided: true, cancelledReview } as const
  })
