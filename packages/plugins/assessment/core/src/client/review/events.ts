import type { Message } from '@qualy/i18n-contract'
import * as m from '#messages'

// What happened to a review, in words. The engine's own vocabulary -
// submitted, escalated, assignee-not-found - is how the domain talks to
// itself; a person reading the trail of their own filing should never meet
// it. One map, used by every screen that shows a trail, so a new event kind
// gains its sentence once.

const WITH_ACTOR: Record<string, Message> = {
  submitted: m.event_submitted,
  approved: m.event_approved,
  rejected: m.event_rejected,
  escalated: m.event_escalated,
  // rounds that walked the escalation route while it was one list with a
  // marker in it, and while it was called something else
  forwarded: m.event_forwarded,
  comment: m.event_comment,
  'recommend-approve': m.event_recommendApprove,
  'recommend-reject': m.event_recommendReject,
  'cancelled-by-submitter': m.event_withdrawn,
  // the office withdrew the record this round was contesting
  'cancelled-by-staff': m.event_cancelledByStaff,
  'returned-for-revision': m.event_returnedForRevision,
  'revision-required': m.event_returnedForRevision,
  appealed: m.event_appealed,
  // staff contesting a conclusion on the participant's behalf
  reopened: m.event_reopened,
  // a result re-determined outside any round, on the claim's own log, and
  // the round it ended
  'recognition-corrected': m.event_recognitionCorrected,
  'approval-revoked': m.event_approvalRevoked,
  'rejection-overturned': m.event_rejectionOverturned,
  'superseded-by-redetermination': m.event_supersededByRedetermination,
  'abandoned-by-submitter': m.event_abandoned,
  'supplement-requested': m.event_supplementRequested,
  'supplement-submitted': m.event_supplementSubmitted,
  'supplement-cancelled': m.event_supplementCancelled,
  // a middle step of the escalation route objecting: an opinion that climbs
  // with the round rather than a verdict on it
  'opinion-rejected': m.event_opinionRejected,
  // and one agreeing: the determination it suggests is where the next step
  // starts, and the verdict is still to come
  'opinion-approved': m.event_opinionApproved,
}

const WITHOUT_ACTOR: Record<string, Message> = {
  'assignee-not-found': m.event_noReviewer,
  'assignee-found': m.event_reviewerFound,
  'cancelled-item-voided': m.event_itemVoided,
  // the claim's own trail, where no round was open to say it
  'voided-with-item': m.event_entryItemVoided,
  // the person whose claim it is left the roster, and the round with them
  'subject-excluded': m.event_subjectExcluded,
  // the route under the round changed, by an administrator's configuration
  // decision rather than by anything anybody said about the filing
  rerouted: m.event_rerouted,
  // a step every holder of had judged an earlier step of this round
  'stage-skipped': m.event_stageSkipped,
}

/**
 * The same conclusions when the round itself reached them: a sitting of
 * several reviewers concluding writes its transition with no actor, and
 * "somebody approved" would invent a person where there was a procedure.
 *
 * Only for a round that really did conclude by itself. A judge whose name
 * this reader is not told (§32.85) is still a judge, and reading their
 * approval as a sitting's unanimous one invents a procedure that never ran.
 */
const ROUND_VOICE: Record<string, Message> = {
  approved: m.event_panelApproved,
  escalated: m.event_panelEscalated,
  'opinion-approved': m.event_panelOpinionApproved,
}

/**
 * The same acts, spoken to the person who did them.
 *
 * The account is one account, but "示例学生 提交了申报" is the wrong
 * sentence on 示例学生's own screen - their trail already speaks to them
 * ("等你补充", "由你决定"), and naming them in the third person beside
 * that reads as somebody else's file. Only the acts the filer themself
 * performs have a second voice; everything a reviewer did keeps its name
 * in every reading.
 */
const OWN_VOICE: Record<string, Message> = {
  submitted: m.event_youSubmitted,
  'cancelled-by-submitter': m.event_youWithdrew,
  appealed: m.event_youAppealed,
  'abandoned-by-submitter': m.event_youAbandoned,
  'supplement-submitted': m.event_youSupplemented,
}

/** the sentence for an act of the reader's own, where it has one */
export const ownReviewEventMessage = (kind: string): Message | undefined => OWN_VOICE[kind]

/**
 * The sentence for one event, and whether it needs the actor's name in it.
 * `named` is whether the event actually carries a person: the same kind
 * reads differently when the round itself did it.
 */
export const reviewEventMessage = (
  kind: string,
  named = true,
  byRound = false,
): { message: Message; needsActor: boolean } => {
  // A round with no actor at all is the procedure speaking. Where the actor
  // exists but is withheld, the sentence keeps its shape and the name slot
  // takes the word for whoever holds that step.
  if (byRound || (!named && byRound)) {
    const round = ROUND_VOICE[kind]
    if (round !== undefined) return { message: round, needsActor: false }
  }
  const withActor = WITH_ACTOR[kind]
  if (withActor !== undefined) return { message: withActor, needsActor: true }
  return { message: WITHOUT_ACTOR[kind] ?? m.event_other, needsActor: false }
}

export const reviewOutcomeMessage = (outcome: string): Message =>
  outcome === 'approved'
    ? m.outcome_approved
    : outcome === 'rejected'
      ? m.outcome_rejected
      : outcome === 'cancelled'
        ? m.outcome_cancelled
        : outcome === 'superseded'
          ? m.outcome_superseded
          : outcome === 'subject-excluded'
            ? m.outcome_subjectExcluded
            : m.outcome_other

/** how a round began, said as its heading's second half */
export const reviewOriginMessage = (origin: string): Message | null =>
  origin === 'appeal'
    ? m.origin_appeal
    : origin === 'reroute'
      ? m.origin_reroute
      : origin === 'reopen'
        ? m.origin_reopen
        : null
