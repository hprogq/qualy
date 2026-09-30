import type { Message } from '@qualy/i18n-contract'
import * as m from '#messages'

// Why an entry action was refused, as a sentence about this round rather
// than about the software. One code carries the whole matrix (§ the entry
// api), so the reason is what a screen renders - and a reason nobody
// translated reaches a person as "this cannot be done right now", which
// tells them nothing they can act on.

const SENTENCES: Record<string, Message> = {
  'not-your-entry': m.entry_refuseNotYours,
  'not-your-participant': m.entry_refuseNotYours,
  'entry-channel-closed': m.entry_refuseChannelClosed,
  'participant-not-found': m.entry_refuseNotYours,
  'participant-not-active': m.entry_refuseNotActive,
  'participant-out-of-reach': m.entry_refuseOutOfReach,
  'entry-not-editable': m.entry_refuseNotEditable,
  'entry-changed': m.entry_refuseEntryChanged,
  'entry-not-submittable': m.entry_refuseNotSubmittable,
  'entry-needs-revision': m.entry_refuseNeedsRevision,
  'entry-not-withdrawable': m.entry_refuseNotWithdrawable,
  'review-under-way': m.entry_refuseReviewUnderWay,
  'appeal-not-withdrawable': m.entry_refuseAppealNotWithdrawable,
  'appeal-under-way': m.entry_refuseAppealUnderWay,
  'nothing-to-appeal': m.entry_refuseNothingToAppeal,
  'appeal-exhausted': m.entry_refuseAppealExhausted,
  'decision-superseded': m.entry_refuseDecisionSuperseded,
  'review-already-open': m.entry_refuseReviewOpen,
  'max-entries-reached': m.entry_refuseMaxEntries,
  'entry-ceiling-reached': m.entry_refuseMaxEntries,
  'account-ceiling-reached': m.entry_refuseRoundCeiling,
  'item-not-active': m.entry_refuseItemVoided,
  'item-not-configured': m.entry_refuseItemUnconfigured,
  'item-type-not-installed': m.entry_refuseItemUnconfigured,
  'review-level-missing': m.entry_refuseReviewLevelMissing,
  'no-appeal-route': m.entry_refuseNoAppealRoute,
  'basis-required': m.entry_refuseBasisRequired,
  'self-record-refused': m.entry_refuseSelfRecord,
  'self-reopen-refused': m.entry_refuseOwnClaim,
  'self-redetermine-refused': m.entry_refuseOwnClaim,
  'redetermination-unchanged': m.entry_refuseRedeterminationUnchanged,
  'nothing-to-redetermine': m.entry_refuseNothingToRedetermine,
  'not-participant': m.entry_refuseNotParticipant,
  'permission-not-held': m.entry_refuseNoPermission,
  'not-reviewer': m.entry_refuseNotReviewer,
  'no-active-phase': m.entry_refusePhaseClosed,
  'phase-closed': m.entry_refusePhaseClosed,
  'item-out-of-scope': m.entry_refuseOutOfScope,
  'participant-out-of-scope': m.entry_refuseOutOfScope,
  'must-revise-first': m.entry_refuseNeedsRevision,
  'entry-not-abandonable': m.entry_refuseNotAbandonable,
  'supplement-already-open': m.refuse_supplementOpen,
  'request-not-open': m.refuse_requestClosed,
  'requirements-unreadable': m.refuse_supplementUnreadable,
  'not-requester': m.entry_refuseNotRequester,
  'awaiting-supplement': m.refuse_awaitingSupplement,
  'review-not-open': m.refuse_reviewNotOpen,
  'item-not-fileable': m.entry_refuseNotFileable,
  'entry-not-returnable': m.entry_refuseNotReturnable,
  'owner-cannot-refile': m.entry_refuseOwnerCannotRefile,
  'reason-required': m.entry_refuseReasonRequired,
  'item-not-administrative': m.entry_refuseNotAdministrative,
  'attachment-required': m.entry_refuseAttachmentRequired,
  'chain-unreadable': m.entry_refuseChainUnreadable,
  'chain-ends-here': m.entry_refuseChainEndsHere,
  'decision-not-available': m.entry_refuseDecisionNotAvailable,
  // what storage said about an upload, passed through as the refusal's reason
  'file-too-large': m.entry_refuseFileTooLarge,
  'owner-quota-exceeded': m.entry_refuseStorageFull,
  'tenant-quota-exceeded': m.entry_refuseStorageFull,
  'too-many-reservations': m.entry_refuseUploadBusy,
  'rate-limited': m.entry_refuseUploadBusy,
  'being-cleaned-up': m.entry_refuseUploadBusy,
  'not-uploaded': m.entry_refuseUploadAgain,
  expired: m.entry_refuseUploadAgain,
  failed: m.entry_refuseUploadAgain,
  oversized: m.entry_refuseUploadAgain,
}

/**
 * Reasons whose sentence depends on the act they held. A route with nowhere
 * to stand is the ordinary review route for a claim being sent, and the
 * review route above it for an appeal or a staff reopening: saying "cannot
 * be sent for review" to somebody pressing "appeal" names the wrong route
 * and the wrong act.
 */
const BY_ACT: Record<string, Record<string, Message>> = {
  appeal: { 'review-level-missing': m.entry_refuseAppealRouteMissing },
  reopen: { 'review-level-missing': m.entry_refuseReopenRouteMissing },
}

/** a reason's sentence, as the act it held needs it said */
const sentenceOf = (action: string | null, reason: string): Message | null =>
  (action === null ? undefined : BY_ACT[action]?.[reason]) ?? SENTENCES[reason] ?? null

/** the sentence for a bare reason code, for a blocked act's tooltip */
export const entryRefusalReason = (reason: string): Message | null => SENTENCES[reason] ?? null

/** where the round stands, as far as saying which stage holds an act goes */
export interface RoundState {
  readonly status: string
  /** the stage under way, by the name the round gave it */
  readonly phaseName: string | null
}

/** a sentence, with whatever fills it */
export interface Said {
  /** which sentence it is, for a test to read off the element without its words */
  readonly said: string
  readonly message: Message
  readonly values?: Readonly<Record<string, string>>
}

/**
 * Why the phase gate holds an act, read against where the round stands: a
 * stage named or unnamed, a round archived or not started, a gap between
 * stages, or a stage open to some questions or some people only.
 */
export type Hold =
  | { readonly why: 'phase'; readonly phase: string }
  | { readonly why: 'stage' | 'archived' | 'unstarted' | 'idle' | 'item' | 'people' }

/** the gate's reason as a hold, or null for a reason that is not the gate's */
export const holdOf = (reason: string | null, round: RoundState | null): Hold | null => {
  switch (reason) {
    case 'phase-closed': {
      const phase = round?.phaseName?.trim() ?? ''
      return phase === '' ? { why: 'stage' } : { why: 'phase', phase }
    }
    case 'no-active-phase':
      return {
        why:
          round?.status === 'archived'
            ? 'archived'
            : round?.status === 'draft'
              ? 'unstarted'
              : 'idle',
      }
    case 'item-out-of-scope':
      return { why: 'item' }
    case 'participant-out-of-scope':
      return { why: 'people' }
    default:
      return null
  }
}

const FILING_HELD: Record<Exclude<Hold['why'], 'phase'>, Said> = {
  stage: { said: 'held-now', message: m.entries_heldNow },
  archived: { said: 'held-archived', message: m.entries_heldArchived },
  unstarted: { said: 'held-not-started', message: m.entries_heldNotStarted },
  idle: { said: 'held-no-phase', message: m.entries_heldNoPhase },
  item: { said: 'held-item-scope', message: m.entries_heldItemScope },
  people: { said: 'held-participant-scope', message: m.entries_heldParticipantScope },
}

/**
 * Why a new claim cannot be started on a question, said about starting one.
 *
 * It stands in place of the way in, so it names the act and, where the round
 * says, the stage that shut it. Two reasons here are not the phase gate's:
 * the round's own limit on claims, and a review route with nowhere to stand
 * for this person, which only the batch's administrator can mend.
 */
export const filingHeldOf = (reason: string | null, round: RoundState | null): Said => {
  const hold = holdOf(reason, round)
  if (hold?.why === 'phase') {
    return { said: 'held-phase', message: m.entries_heldPhase, values: { phase: hold.phase } }
  }
  if (hold !== null) return FILING_HELD[hold.why]
  return reason === 'account-ceiling-reached'
    ? { said: 'held-round-full', message: m.entries_heldRoundFull }
    : reason === 'review-level-missing'
      ? { said: 'held-route', message: m.entries_heldRoute }
      : { said: 'held-now', message: m.entries_heldNow }
}

/** the owner's acts on a claim of theirs that a stage may hold */
export type HeldAct = 'edit' | 'submit' | 'withdraw' | 'abandon' | 'appeal'

const HELD_ACTS: ReadonlySet<string> = new Set<HeldAct>([
  'edit',
  'submit',
  'withdraw',
  'abandon',
  'appeal',
])

/** how the sentences below are put into words */
export interface HeldWords {
  readonly locale: string
}

/**
 * Why the stage holds some of the owner's acts on a claim, naming them.
 *
 * The general refusal says the stage "does not allow this action" and leaves
 * the reader to guess which; here the acts are known, so they are named -
 * several at once where one stage holds several - and so is the stage, where
 * the round gives it a name.
 */
export const sayHeld = (hold: Hold, acts: readonly HeldAct[], words: HeldWords): string =>
  m.entry_held({
    why: hold.why,
    phase: hold.why === 'phase' ? hold.phase : '',
    acts: new Intl.ListFormat(words.locale, { type: 'disjunction' }).format(
      acts.map((act) => m.entry_heldAct({ act })),
    ),
  })

/** why one of the owner's acts is not open now, for the hint on its key */
export const sayBlocked = (
  act: HeldAct,
  reason: string | null,
  round: RoundState | null,
  words: HeldWords,
): string => {
  const hold = holdOf(reason, round)
  if (hold !== null) return sayHeld(hold, [act], words)
  return ((reason === null ? null : sentenceOf(act, reason)) ?? m.entry_blockedNow)()
}

/** the act and the reason of a refused entry act, or null when this is not one */
export const refusalOf = (error: unknown): { action: string; reason: string } | null => {
  const refusal = error as { _tag?: string; action?: unknown; reason?: unknown } | null
  if (refusal?._tag !== 'ASSESSMENT_ENTRY_ACTION_REFUSED') return null
  return {
    action: typeof refusal.action === 'string' ? refusal.action : '',
    reason: typeof refusal.reason === 'string' ? refusal.reason : '',
  }
}

/**
 * A refusal of one of the owner's own acts, or null when this is not one.
 *
 * Where the stage is what said no, the sentence names the act the server
 * refused and the stage that holds it - starting a claim in the words its
 * question uses for it. Anything else is the refusal's own sentence.
 */
export const sayOwnRefusal = (
  error: unknown,
  round: RoundState | null,
  words: HeldWords,
): string | null => {
  const refusal = refusalOf(error)
  if (refusal === null) return null
  const hold = holdOf(refusal.reason, round)
  if (hold !== null && refusal.action === 'create') {
    const said = filingHeldOf(refusal.reason, round)
    return said.message(said.values === undefined ? undefined : { ...said.values })
  }
  if (hold !== null && HELD_ACTS.has(refusal.action)) {
    return sayHeld(hold, [refusal.action as HeldAct], words)
  }
  return (sentenceOf(refusal.action, refusal.reason) ?? m.entry_refuseOther)()
}

/** the sentence for a refusal, or null when this is not one */
export const entryRefusalMessage = (error: unknown): Message | null => {
  const refusal = refusalOf(error)
  if (refusal === null) return null
  return sentenceOf(refusal.action, refusal.reason) ?? m.entry_refuseOther
}

/**
 * What to tell a person about an act that failed: a refusal in its own
 * words, anything else the way every error is said.
 */
export const sayEntryFailure = (
  error: unknown,
  words: {
    formatError: (error: unknown) => string
  },
): string => {
  const refusal = entryRefusalMessage(error)
  return refusal === null ? words.formatError(error) : refusal()
}
