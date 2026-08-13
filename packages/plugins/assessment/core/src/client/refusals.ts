import type { MessageDescriptor } from '@qualy/i18n-contract'
import type { EditRefusalReason } from '../phase/engine/edits.ts'
import { assessmentMessages as m } from './i18n.ts'

// A plan refusal, as a sentence.
//
// The api answers a refused plan with the engine's own reasons rather than a
// message, because the same reason means different things in different places
// on the screen - which is exactly why the mapping lives here, next to the
// editor, instead of being resolved on the server.

/**
 * The reasons only the service can decide, beyond the engine's own enum:
 * whole-plan rules (removal, reordering, immutability once active) and the
 * roster allowance check.
 */
type ServiceRefusalReason =
  | 'plan-empty'
  | 'template-requires-draft'
  | 'template-not-a-timeline'
  | 'phase-template-shape'
  | 'phase-removed'
  | 'reorder-not-allowed'
  | 'phase-key-immutable'
  | 'scope-in-template'
  | 'participant-not-in-batch'
  | 'item-not-in-batch'

/**
 * Every refusal reason the api can return, mapped to its explanation. Typed
 * by the enums themselves: a reason the engine gains without a sentence here
 * stops compiling rather than reaching an administrator as an identifier.
 */
const SENTENCES: Record<EditRefusalReason | ServiceRefusalReason, MessageDescriptor> = {
  'phase-not-found': m['refusal.phase-not-found'],
  'actual-immutable': m['refusal.actual-immutable'],
  'phase-already-entered': m['refusal.phase-already-entered'],
  'ended-phase-name-only': m['refusal.ended-phase-name-only'],
  'display-name-blank': m['refusal.display-name-blank'],
  'planned-not-in-future': m['refusal.planned-not-in-future'],
  'planned-out-of-order': m['refusal.planned-out-of-order'],
  'profile-code-not-gated': m['refusal.profile-code-not-gated'],
  'insert-not-after-current': m['refusal.insert-not-after-current'],
  'schedule-out-of-order': m['refusal.schedule-out-of-order'],
  'unschedule-not-from-tail': m['refusal.unschedule-not-from-tail'],
  'scheduled-phase-immutable': m['refusal.scheduled-phase-immutable'],
  'plan-empty': m['refusal.plan-empty'],
  'template-requires-draft': m['refusal.template-requires-draft'],
  'template-not-a-timeline': m['refusal.template-not-a-timeline'],
  'phase-template-shape': m['refusal.phase-template-shape'],
  'phase-removed': m['refusal.phase-removed'],
  'reorder-not-allowed': m['refusal.reorder-not-allowed'],
  'phase-key-immutable': m['refusal.phase-key-immutable'],
  'scope-in-template': m['refusal.scope-in-template'],
  'participant-not-in-batch': m['refusal.participant-not-in-batch'],
  'item-not-in-batch': m['refusal.item-not-in-batch'],
}

export interface PlanRefusalLike {
  reason: string
  phaseId?: string | null
  index?: number | undefined
}

/**
 * The refusals a failed plan write carried, if it carried any.
 *
 * A refused plan arrives as ASSESSMENT_PLAN_INVALID with the list attached;
 * anything else is somebody else's failure and formatError says so.
 */
export function refusalsOf(error: unknown): readonly PlanRefusalLike[] {
  const tagged = error as { _tag?: string; refusals?: readonly PlanRefusalLike[] } | null
  if (!tagged || tagged._tag !== 'ASSESSMENT_PLAN_INVALID') return []
  return tagged.refusals ?? []
}

export const refusalMessage = (reason: string): MessageDescriptor | undefined =>
  (SENTENCES as Record<string, MessageDescriptor | undefined>)[reason]
