import type { Message } from '@qualy/i18n-contract'
import { MAX_PLAN_PHASES } from '../api.ts'
import type { EditRefusalReason } from '../phase/engine/edits.ts'
import * as m from '#messages'

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
  | 'phase-duplicated'
  | 'reorder-not-allowed'
  | 'phase-key-immutable'
  | 'scope-in-template'
  | 'participant-not-in-batch'
  | 'item-not-in-batch'
  | 'plan-too-long'
  | 'plan-changed'

/**
 * Every refusal reason the api can return, mapped to its explanation. Typed
 * by the enums themselves: a reason the engine gains without a sentence here
 * stops compiling rather than reaching an administrator as an identifier.
 */
const SENTENCES: Record<EditRefusalReason | ServiceRefusalReason, Message> = {
  'phase-not-found': m.refusal_phaseNotFound,
  'actual-immutable': m.refusal_actualImmutable,
  'phase-already-entered': m.refusal_phaseAlreadyEntered,
  'ended-phase-name-only': m.refusal_endedPhaseNameOnly,
  'display-name-blank': m.refusal_displayNameBlank,
  'planned-not-in-future': m.refusal_plannedNotInFuture,
  'planned-out-of-order': m.refusal_plannedOutOfOrder,
  'profile-code-not-gated': m.refusal_profileCodeNotGated,
  'insert-not-after-current': m.refusal_insertNotAfterCurrent,
  'schedule-out-of-order': m.refusal_scheduleOutOfOrder,
  'unschedule-not-from-tail': m.refusal_unscheduleNotFromTail,
  'scheduled-phase-immutable': m.refusal_scheduledPhaseImmutable,
  'plan-empty': m.refusal_planEmpty,
  'template-requires-draft': m.refusal_templateRequiresDraft,
  'template-not-a-timeline': m.refusal_templateNotATimeline,
  'phase-template-shape': m.refusal_phaseTemplateShape,
  'phase-removed': m.refusal_phaseRemoved,
  'phase-duplicated': m.refusal_phaseDuplicated,
  'reorder-not-allowed': m.refusal_reorderNotAllowed,
  'phase-key-immutable': m.refusal_phaseKeyImmutable,
  'scope-in-template': m.refusal_scopeInTemplate,
  'participant-not-in-batch': m.refusal_participantNotInBatch,
  'item-not-in-batch': m.refusal_itemNotInBatch,
  'plan-too-long': m.refusal_planTooLong,
  'plan-changed': m.refusal_planChanged,
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

export const refusalMessage = (reason: string): Message | undefined =>
  (SENTENCES as Record<string, Message | undefined>)[reason]

/**
 * A plan refusal as the sentence a screen shows, with the limits it speaks
 * of filled in from the same constants the api holds the plan to.
 */
export const planRefusalWords = (reason: string): string => {
  const message = refusalMessage(reason)
  return message === undefined ? reason : message({ most: MAX_PLAN_PHASES })
}
