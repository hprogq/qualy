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
  'account-ceiling-reached': m.refuseRoundCeiling,
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

/** where the round stands, as far as saying which stage holds an act goes */
export interface RoundState {
  readonly status: string
  /** the stage under way, by the name the round gave it */
  readonly phaseName: string | null
}

/** a sentence, with whatever fills it */
export interface Said {
  readonly message: MessageDescriptor
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

const FILING_HELD: Record<Exclude<Hold['why'], 'phase'>, MessageDescriptor> = {
  stage: m.entriesHeldNow,
  archived: m.entriesHeldArchived,
  unstarted: m.entriesHeldNotStarted,
  idle: m.entriesHeldNoPhase,
  item: m.entriesHeldItemScope,
  people: m.entriesHeldParticipantScope,
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
  if (hold?.why === 'phase') return { message: m.entriesHeldPhase, values: { phase: hold.phase } }
  if (hold !== null) return { message: FILING_HELD[hold.why] }
  return reason === 'account-ceiling-reached'
    ? { message: m.entriesHeldRoundFull }
    : reason === 'review-level-missing'
      ? { message: m.entriesHeldRoute }
      : { message: m.entriesHeldNow }
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
  readonly format: (descriptor: MessageDescriptor, values?: Record<string, string>) => string
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
  words.format(m.entryHeld, {
    why: hold.why,
    phase: hold.why === 'phase' ? hold.phase : '',
    acts: new Intl.ListFormat(words.locale, { type: 'disjunction' }).format(
      acts.map((act) => words.format(m.entryHeldAct, { act })),
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
  return words.format((reason === null ? null : entryRefusalReason(reason)) ?? m.entryBlockedNow)
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
    return words.format(said.message, said.values === undefined ? undefined : { ...said.values })
  }
  if (hold !== null && HELD_ACTS.has(refusal.action)) {
    return sayHeld(hold, [refusal.action as HeldAct], words)
  }
  return words.format(SENTENCES[refusal.reason] ?? m.refuseOther)
}

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
