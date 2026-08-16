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
}

const WITHOUT_ACTOR: Record<string, MessageDescriptor> = {
  'assignee-not-found': m.eventNoReviewer,
  'assignee-found': m.eventReviewerFound,
  'cancelled-item-voided': m.eventItemVoided,
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
        : m.outcomeOther
