import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentMessages as m } from '../i18n.ts'

// What happened to a review, in words. The engine's own vocabulary -
// submitted, escalated, assignee-not-found - is how the domain talks to
// itself; a person reading the trail of their own filing should never meet
// it. One map, used by every screen that shows a trail, so a new event kind
// gains its sentence once.

const WITH_ACTOR: Record<string, MessageDescriptor> = {
  submitted: m.eventSubmitted,
  approved: m.eventApproved,
  rejected: m.eventRejected,
  escalated: m.eventEscalated,
  // rounds that walked the escalation route while it was one list with a
  // marker in it, and while it was called something else
  forwarded: m.eventForwarded,
  comment: m.eventComment,
  'recommend-approve': m.eventRecommendApprove,
  'recommend-reject': m.eventRecommendReject,
  'cancelled-by-submitter': m.eventWithdrawn,
  'returned-for-revision': m.eventReturnedForRevision,
  'revision-required': m.eventReturnedForRevision,
  appealed: m.eventAppealed,
  'abandoned-by-submitter': m.eventAbandoned,
  'supplement-requested': m.eventSupplementRequested,
  'supplement-submitted': m.eventSupplementSubmitted,
  'supplement-cancelled': m.eventSupplementCancelled,
}

const WITHOUT_ACTOR: Record<string, MessageDescriptor> = {
  'assignee-not-found': m.eventNoReviewer,
  'assignee-found': m.eventReviewerFound,
  'cancelled-item-voided': m.eventItemVoided,
  // the route under the round changed, by an administrator's configuration
  // decision rather than by anything anybody said about the filing
  rerouted: m.eventRerouted,
}

/** the sentence for one event, and whether it needs the actor's name in it */
export const reviewEventMessage = (
  kind: string,
): { message: MessageDescriptor; needsActor: boolean } => {
  const withActor = WITH_ACTOR[kind]
  if (withActor !== undefined) return { message: withActor, needsActor: true }
  return { message: WITHOUT_ACTOR[kind] ?? m.eventOther, needsActor: false }
}

export const reviewOutcomeMessage = (outcome: string): MessageDescriptor =>
  outcome === 'approved'
    ? m.outcomeApproved
    : outcome === 'rejected'
      ? m.outcomeRejected
      : outcome === 'cancelled'
        ? m.outcomeCancelled
        : outcome === 'superseded'
          ? m.outcomeSuperseded
          : m.outcomeOther

/** how a round began, said as its heading's second half */
export const reviewOriginMessage = (origin: string): MessageDescriptor | null =>
  origin === 'appeal'
    ? m.originAppeal
    : origin === 'reroute'
      ? m.originReroute
      : origin === 'reopen'
        ? m.originReopen
        : null
