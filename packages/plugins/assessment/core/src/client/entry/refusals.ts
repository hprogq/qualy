import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentMessages as m } from '../i18n.ts'

// Why an entry action was refused, as a sentence about this round rather
// than about the software. One code carries the whole matrix (§ the entry
// api), so the reason is what a screen renders - and a reason nobody
// translated reaches a person as "this cannot be done right now", which
// tells them nothing they can act on.

const SENTENCES: Record<string, MessageDescriptor> = {
  'not-your-entry': m.refuseNotYours,
  'not-your-participant': m.refuseNotYours,
  'entry-channel-closed': m.refuseChannelClosed,
  'participant-not-found': m.refuseNotYours,
  'participant-not-active': m.refuseNotActive,
  'participant-out-of-reach': m.refuseOutOfReach,
  'entry-not-editable': m.refuseNotEditable,
  'entry-changed': m.refuseEntryChanged,
  'entry-not-submittable': m.refuseNotSubmittable,
  'entry-needs-revision': m.refuseNeedsRevision,
  'entry-not-withdrawable': m.refuseNotWithdrawable,
  'review-under-way': m.refuseReviewUnderWay,
  'appeal-not-withdrawable': m.refuseAppealNotWithdrawable,
  'appeal-under-way': m.refuseAppealUnderWay,
  'nothing-to-appeal': m.refuseNothingToAppeal,
  'appeal-exhausted': m.refuseAppealExhausted,
  'decision-superseded': m.refuseDecisionSuperseded,
  'review-already-open': m.refuseReviewOpen,
  'max-entries-reached': m.refuseMaxEntries,
  'entry-ceiling-reached': m.refuseMaxEntries,
  'item-not-active': m.refuseItemVoided,
  'item-not-configured': m.refuseItemUnconfigured,
  'item-type-not-installed': m.refuseItemUnconfigured,
  'review-level-missing': m.refuseReviewLevelMissing,
  'no-appeal-route': m.refuseNoAppealRoute,
  'basis-required': m.refuseBasisRequired,
  'self-record-refused': m.refuseSelfRecord,
  'self-reopen-refused': m.refuseOwnClaim,
  'self-redetermine-refused': m.refuseOwnClaim,
  'redetermination-unchanged': m.refuseRedeterminationUnchanged,
  'nothing-to-redetermine': m.refuseNothingToRedetermine,
  'not-participant': m.refuseNotParticipant,
  'permission-not-held': m.refuseNoPermission,
  'not-reviewer': m.refuseNotReviewer,
  'no-active-phase': m.refusePhaseClosed,
  'phase-closed': m.refusePhaseClosed,
  'item-out-of-scope': m.refuseOutOfScope,
  'participant-out-of-scope': m.refuseOutOfScope,
  'must-revise-first': m.refuseNeedsRevision,
  'entry-not-abandonable': m.refuseNotAbandonable,
  'supplement-already-open': m.refuseSupplementOpen,
  'request-not-open': m.refuseRequestClosed,
  'requirements-unreadable': m.refuseSupplementUnreadable,
  'not-requester': m.refuseNotRequester,
  'awaiting-supplement': m.refuseAwaitingSupplement,
  'review-not-open': m.refuseReviewNotOpen,
  'item-not-fileable': m.refuseNotFileable,
  'entry-not-returnable': m.refuseNotReturnable,
  'owner-cannot-refile': m.refuseOwnerCannotRefile,
  'reason-required': m.refuseReasonRequired,
  'item-not-administrative': m.refuseNotAdministrative,
  'attachment-required': m.refuseAttachmentRequired,
  'chain-unreadable': m.refuseChainUnreadable,
  'chain-ends-here': m.refuseChainEndsHere,
  'decision-not-available': m.refuseDecisionNotAvailable,
  // what storage said about an upload, passed through as the refusal's reason
  'file-too-large': m.refuseFileTooLarge,
  'owner-quota-exceeded': m.refuseStorageFull,
  'tenant-quota-exceeded': m.refuseStorageFull,
  'too-many-reservations': m.refuseUploadBusy,
  'rate-limited': m.refuseUploadBusy,
  'being-cleaned-up': m.refuseUploadBusy,
  'not-uploaded': m.refuseUploadAgain,
  expired: m.refuseUploadAgain,
  failed: m.refuseUploadAgain,
  oversized: m.refuseUploadAgain,
}

/** the sentence for a bare reason code, for a blocked act's tooltip */
export const entryRefusalReason = (reason: string): MessageDescriptor | null =>
  SENTENCES[reason] ?? null

/** the sentence for a refusal, or null when this is not one */
export const entryRefusalMessage = (error: unknown): MessageDescriptor | null => {
  const refusal = error as { _tag?: string; reason?: string }
  if (refusal?._tag !== 'ASSESSMENT_ENTRY_ACTION_REFUSED') return null
  return SENTENCES[refusal.reason ?? ''] ?? m.refuseOther
}

/**
 * What to tell a person about an act that failed: a refusal in its own
 * words, anything else the way every error is said.
 */
export const sayEntryFailure = (
  error: unknown,
  words: {
    format: (descriptor: MessageDescriptor) => string
    formatError: (error: unknown) => string
  },
): string => {
  const refusal = entryRefusalMessage(error)
  return refusal === null ? words.formatError(error) : words.format(refusal)
}
