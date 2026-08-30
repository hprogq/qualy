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
  'participant-not-found': m.refuseNotYours,
  'participant-not-active': m.refuseNotActive,
  'participant-out-of-reach': m.refuseOutOfReach,
  'entry-not-editable': m.refuseNotEditable,
  'entry-not-submittable': m.refuseNotSubmittable,
  'entry-needs-revision': m.refuseNeedsRevision,
  'entry-not-withdrawable': m.refuseNotWithdrawable,
  'review-under-way': m.refuseReviewUnderWay,
  'appeal-not-withdrawable': m.refuseAppealNotWithdrawable,
  'nothing-to-appeal': m.refuseNothingToAppeal,
  'decision-superseded': m.refuseDecisionSuperseded,
  'review-already-open': m.refuseReviewOpen,
  'max-entries-reached': m.refuseMaxEntries,
  'item-not-active': m.refuseItemVoided,
  'item-not-configured': m.refuseItemUnconfigured,
  'item-type-not-installed': m.refuseItemUnconfigured,
  'review-level-missing': m.refuseReviewLevelMissing,
  'basis-required': m.refuseBasisRequired,
  'self-record-refused': m.refuseSelfRecord,
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
