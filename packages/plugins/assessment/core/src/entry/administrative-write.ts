import { Effect } from 'effect'
import { insertRecognitionsWithIds } from '../scoring/recognition-db.ts'
import {
  approveNewEntries,
  bumpParticipantAttention,
  cancelReviewInstance,
  insertEntriesWithIds,
  insertEntryEvent,
  insertEntryRevisionsWithIds,
  insertReviewEvent,
  insertRevisionAttachments,
  setEntryState,
  type EntrySource,
  type EntryStatus,
} from './db.ts'
import { uuidv7 } from './uuid-v7.ts'

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

/** how many facts go into one statement: well under the protocol's parameter limit */
const WRITE_CHUNK = 500

/**
 * The write for many facts at once, and the ids each produced, in order.
 *
 * A fixed handful of statements per chunk, however many facts: the entries
 * as drafts, their revisions, the files they cite, their determinations, and
 * one update approving them all on what was just written. An import of two
 * thousand rows used to be ten thousand round trips with the batch locked,
 * and every other write to the batch waited behind them. The ids are chosen
 * here because the statements after the first need them, and a multi-row
 * insert does not promise which row it answers first.
 *
 * The caller is responsible for having bound any attachments before calling:
 * binding takes its own locks and reads history, which is the caller's
 * transaction's business rather than this statement sequence's.
 */
export const recordAdministrativeEntriesTx = (inputs: readonly AdministrativeWrite[]) =>
  Effect.gen(function* () {
    const planned = inputs.map((input) => ({
      input,
      entryId: uuidv7(),
      revisionId: uuidv7(),
      recognitionId: input.recognition === undefined ? undefined : uuidv7(),
    }))
    for (let start = 0; start < planned.length; start += WRITE_CHUNK) {
      const chunk = planned.slice(start, start + WRITE_CHUNK)
      yield* insertEntriesWithIds(
        chunk.map(({ input, entryId }) => ({
          id: entryId,
          tenantId: input.tenantId,
          batchId: input.batchId,
          itemId: input.itemId,
          participantId: input.participantId,
          source: input.source,
          status: 'draft' as const,
        })),
      )
      yield* insertEntryRevisionsWithIds(
        chunk.map(({ input, entryId, revisionId }) => ({
          id: revisionId,
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
        })),
      )
      for (const { input, revisionId } of chunk) {
        yield* insertRevisionAttachments(
          input.tenantId,
          revisionId,
          input.attachments.map((ref, position) => ({ attachmentId: ref.attachmentId, position })),
        )
      }
      yield* insertRecognitionsWithIds(
        chunk.flatMap(({ input, entryId, revisionId, recognitionId }) =>
          recognitionId === undefined || input.recognition === undefined
            ? []
            : [
                {
                  id: recognitionId,
                  tenantId: input.tenantId,
                  batchId: input.batchId,
                  entryId,
                  entryRevisionId: revisionId,
                  itemId: input.itemId,
                  itemRevisionId: input.itemRevisionId,
                  values: input.recognition,
                  // the provenance of the determination is the provenance of
                  // the fact: a record's determination is a record's, an
                  // import's is an import's, and a row that says one on the
                  // entry and the other on the recognition has split its own
                  // history
                  source: input.source,
                  createdBy: input.actorUserId,
                },
              ],
        ),
      )
      // a fact somebody else just added to their account is exactly what the
      // unread marker exists for: the broadcast reaches whoever is looking,
      // the marker whoever is not - per entry, because it is durable state on
      // the owner's own row rather than a notification
      const tenants = new Set(chunk.map(({ input }) => input.tenantId))
      for (const tenantId of tenants) {
        const ids = chunk
          .filter(({ input }) => input.tenantId === tenantId)
          .map(({ entryId }) => entryId)
        const approved = yield* approveNewEntries(tenantId, ids)
        if (approved !== ids.length) {
          return yield* Effect.die(
            new Error(
              `approved ${String(approved)} of ${String(ids.length)} new administrative entries`,
            ),
          )
        }
      }
    }
    return planned.map(({ entryId, revisionId }) => ({ entryId, revisionId }))
  })

/**
 * One fact: the same statements as many, for a single member of staff
 * recording on a single person. Kept as the one sequence rather than a copy
 * of it, because the order is load-bearing and two copies would drift.
 */
export const recordAdministrativeEntryTx = (input: AdministrativeWrite) =>
  Effect.map(recordAdministrativeEntriesTx([input]), (written) => written[0]!)

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
    // The round, not the status: a claim under appeal keeps the standing it
    // already had (§32.21), so an approved fact can be carrying an open
    // round. The entry goes on pointing at its round after that round ends,
    // which is what lets a reader find the decision - so the question is put
    // to the round, and `cancelReviewInstance` only closes one that is still
    // open. A `false` here is "there was nothing open", not a failure.
    if (input.currentReviewInstanceId !== null) {
      const closed = yield* cancelReviewInstance({
        tenantId: input.tenantId,
        instanceId: input.currentReviewInstanceId,
        outcome: 'cancelled',
      })
      if (closed) {
        yield* insertReviewEvent({
          tenantId: input.tenantId,
          reviewInstanceId: input.currentReviewInstanceId,
          kind: 'cancelled-by-staff',
          actorId: input.actorUserId,
          comment: input.reason,
        })
        cancelledReview = true
      }
    }
    const gone = yield* setEntryState({
      tenantId: input.tenantId,
      entryId: input.entryId,
      from: ['draft', 'rejected', 'needs_revision', 'in_review', 'approved'],
      to: 'voided',
      ...(cancelledReview ? { currentReviewInstanceId: null } : {}),
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
