import { PHASE_GATED } from '../../permissions.ts'
import { effectiveState, isScheduled, scheduledIndex } from './queue.ts'
import type { EpochMillis, PhasePlan, PhaseSnapshot } from './types.ts'

// The plan editing rules, as structured verdicts rather than booleans: the
// service refuses with these reasons and the ui explains them, so the enum is
// defined once here and consumed everywhere.
//
// The whole rule set now rests on one shape, which §32.41 fixes: a plan is an
// entered prefix, then a scheduled prefix, then an unscheduled suffix. Time
// is committed from the top down and withdrawn from the bottom up; structure
// is free in the suffix and frozen once a phase has a time. Everything an
// administrator may or may not do follows from where a phase sits in that
// shape, which is a sentence a screen can say out loud.
//
// "Entered" is decided by the clock (effectiveState), not by materialization:
// a boundary the scheduler has not ratified yet is still history, and history
// is not editable.

export type EditRefusalReason =
  | 'phase-not-found'
  | 'actual-immutable'
  | 'phase-already-entered'
  | 'ended-phase-name-only'
  | 'display-name-blank'
  | 'planned-not-in-future'
  | 'planned-out-of-order'
  | 'profile-code-not-gated'
  /** a phase may only be scheduled when every phase before it already is */
  | 'schedule-out-of-order'
  /** and unscheduled only from the tail of what is scheduled */
  | 'unschedule-not-from-tail'
  /** structure is frozen once a phase carries a time */
  | 'scheduled-phase-immutable'
  | 'insert-not-after-current'

export interface EditRefusal {
  readonly reason: EditRefusalReason
  readonly phaseId: string | null
  /** the phase whose state blocks the edit, when it is not the edited one */
  readonly blockingPhaseId?: string
  /** the offending permission code, for profile refusals */
  readonly code?: string
  /** position in a submitted spec list, for whole-plan reviews */
  readonly index?: number
}

export type EditWarningReason = 'proxy-without-submit'

export interface EditWarning {
  readonly reason: EditWarningReason
  readonly phaseId: string | null
  /** position in a submitted spec list, for whole-plan reviews */
  readonly index?: number
}

export interface EditReview {
  readonly refusals: readonly EditRefusal[]
  readonly warnings: readonly EditWarning[]
}

export type PlanEdit =
  | { readonly kind: 'rename'; readonly phaseId: string; readonly displayName: string }
  | { readonly kind: 'describe'; readonly phaseId: string; readonly description: string }
  | {
      readonly kind: 'set-planned'
      readonly phaseId: string
      readonly plannedEntryAt: EpochMillis | null
    }
  | { readonly kind: 'set-actual'; readonly phaseId: string; readonly actualEntryAt: EpochMillis }
  | {
      readonly kind: 'set-profile'
      readonly phaseId: string
      readonly permissionProfile: readonly string[]
    }

/** what a plan insertion states; it is born unscheduled and unentered */
export interface NewPhaseSpec {
  readonly phaseKey: string
  readonly displayName: string
  readonly description?: string
  readonly permissionProfile?: readonly string[]
}

const ok = (warnings: readonly EditWarning[] = []): EditReview => ({ refusals: [], warnings })
const refuse = (refusals: readonly EditRefusal[]): EditReview => ({ refusals, warnings: [] })

/** per-phase clock verdicts the individual rules share */
interface PlanView {
  readonly effectiveIndex: number
  /** semantic entry instants, materialized and pending alike */
  readonly enteredAt: ReadonlyMap<string, EpochMillis>
}

const viewOf = (plan: PhasePlan, now: EpochMillis): PlanView => {
  const state = effectiveState(plan, now)
  const enteredAt = new Map<string, EpochMillis>()
  for (const phase of plan) {
    if (phase.actualEntryAt !== null) enteredAt.set(phase.id, phase.actualEntryAt)
  }
  for (const pending of state.pending) enteredAt.set(pending.phaseId, pending.actualEntryAt)
  return { effectiveIndex: state.index, enteredAt }
}

/** the codes a phase may open: the gate's own registry, nothing else */
function profileReview(phaseId: string | null, profile: readonly string[]): EditReview {
  const refusals: EditRefusal[] = []
  for (const code of profile) {
    if (!PHASE_GATED.has(code)) {
      refusals.push({ reason: 'profile-code-not-gated', phaseId, code })
    }
  }
  const warnings: EditWarning[] = []
  // recording on a student's behalf without letting anything be submitted is
  // a profile that opens a door into a room with no exit
  if (profile.includes('assessment.entry.proxy') && !profile.includes('assessment.entry.submit')) {
    warnings.push({ reason: 'proxy-without-submit', phaseId })
  }
  return { refusals, warnings }
}

/**
 * A planned instant must be in the future and must not overtake the phase
 * before it. Nothing else constrains it: with the prefix invariant in place,
 * every earlier phase already has a time to compare against.
 */
function plannedRefusals(
  plan: PhasePlan,
  view: PlanView,
  index: number,
  planned: EpochMillis,
  now: EpochMillis,
): readonly EditRefusal[] {
  const refusals: EditRefusal[] = []
  const phase = plan[index]
  const phaseId = phase?.id ?? null
  if (planned <= now) refusals.push({ reason: 'planned-not-in-future', phaseId })
  const before = index > 0 ? plan[index - 1] : undefined
  if (before !== undefined) {
    const at = view.enteredAt.get(before.id) ?? before.plannedEntryAt
    if (at !== null && at !== undefined && planned <= at) {
      refusals.push({ reason: 'planned-out-of-order', phaseId, blockingPhaseId: before.id })
    }
  }
  const after = plan[index + 1]
  if (after?.plannedEntryAt != null && after.plannedEntryAt <= planned) {
    refusals.push({ reason: 'planned-out-of-order', phaseId, blockingPhaseId: after.id })
  }
  return refusals
}

/** one edit against the plan it would change */
export function reviewPlanEdit(plan: PhasePlan, now: EpochMillis, edit: PlanEdit): EditReview {
  const index = plan.findIndex((phase) => phase.id === edit.phaseId)
  const phase = plan[index]
  if (phase === undefined) return refuse([{ reason: 'phase-not-found', phaseId: edit.phaseId }])
  const view = viewOf(plan, now)
  const entered = view.enteredAt.has(phase.id)
  const ended = index < view.effectiveIndex

  switch (edit.kind) {
    case 'rename':
      return edit.displayName.trim() === ''
        ? refuse([{ reason: 'display-name-blank', phaseId: phase.id }])
        : ok()
    case 'describe':
      // a description is prose about a phase, editable for as long as the
      // phase is worth describing
      return ok()
    case 'set-actual':
      return refuse([{ reason: 'actual-immutable', phaseId: phase.id }])
    case 'set-planned': {
      if (entered) return refuse([{ reason: 'phase-already-entered', phaseId: phase.id }])
      if (edit.plannedEntryAt === null) {
        // withdrawing time is only legal at the tail of what is scheduled
        return index === scheduledIndex(plan)
          ? ok()
          : refuse([{ reason: 'unschedule-not-from-tail', phaseId: phase.id }])
      }
      // committing time is only legal at the head of what is not
      if (!isScheduled(phase) && index !== scheduledIndex(plan) + 1) {
        return refuse([{ reason: 'schedule-out-of-order', phaseId: phase.id }])
      }
      const refusals = plannedRefusals(plan, view, index, edit.plannedEntryAt, now)
      return refusals.length > 0 ? refuse(refusals) : ok()
    }
    case 'set-profile': {
      if (ended) return refuse([{ reason: 'ended-phase-name-only', phaseId: phase.id }])
      return profileReview(phase.id, edit.permissionProfile)
    }
  }
}

/**
 * Where a new phase may land: in the unscheduled suffix, which is the only
 * part of a plan that has promised nothing yet. A phase that already carries
 * a time has been announced, and announcements do not get reordered.
 */
export function reviewInsertion(
  plan: PhasePlan,
  now: EpochMillis,
  position: number,
  spec: NewPhaseSpec,
): EditReview {
  const view = viewOf(plan, now)
  const refusals: EditRefusal[] = []
  if (position <= view.effectiveIndex) {
    refusals.push({ reason: 'insert-not-after-current', phaseId: null })
  }
  if (position <= scheduledIndex(plan)) {
    refusals.push({ reason: 'scheduled-phase-immutable', phaseId: null })
  }
  if (spec.displayName.trim() === '') {
    refusals.push({ reason: 'display-name-blank', phaseId: null })
  }
  if (refusals.length > 0) return refuse(refusals)
  return profileReview(null, spec.permissionProfile ?? [])
}

/** the ordinal arithmetic of an insertion the review already accepted */
export interface InsertionPlacement {
  /** the ordinal the new phase takes */
  readonly ordinal: number
  /** existing phases whose ordinal shifts up, in plan order */
  readonly shifted: readonly { readonly phaseId: string; readonly ordinal: number }[]
}

export function planInsertion(plan: PhasePlan, position: number): InsertionPlacement {
  const at = plan[position]
  const ordinal =
    at !== undefined ? at.ordinal : plan.length > 0 ? plan[plan.length - 1]!.ordinal + 1 : 0
  return {
    ordinal,
    shifted: plan
      .slice(position)
      .map((phase) => ({ phaseId: phase.id, ordinal: phase.ordinal + 1 })),
  }
}

/**
 * A whole plan of specs, reviewed at once - what a draft rewrite or a
 * template append submits. Times are not part of a spec list: a plan arrives
 * as structure, and every instant on it is committed afterwards, one phase at
 * a time.
 */
export function reviewPlan(specs: readonly NewPhaseSpec[]): EditReview {
  const refusals: EditRefusal[] = []
  const warnings: EditWarning[] = []
  specs.forEach((spec, index) => {
    if (spec.displayName.trim() === '') {
      refusals.push({ reason: 'display-name-blank', phaseId: null, index })
    }
    const profile = profileReview(null, spec.permissionProfile ?? [])
    refusals.push(...profile.refusals.map((refusal) => ({ ...refusal, index })))
    warnings.push(...profile.warnings.map((warning) => ({ ...warning, index })))
  })
  return { refusals, warnings }
}

/** the plan as it becomes after an accepted edit; callers keep the order */
export function applyToPlan(plan: PhasePlan, edit: PlanEdit): PhasePlan {
  return plan.map((phase): PhaseSnapshot => {
    if (phase.id !== edit.phaseId) return phase
    switch (edit.kind) {
      case 'rename':
        return { ...phase, displayName: edit.displayName }
      case 'describe':
        return { ...phase, description: edit.description }
      case 'set-planned':
        return { ...phase, plannedEntryAt: edit.plannedEntryAt }
      case 'set-actual':
        return { ...phase, actualEntryAt: edit.actualEntryAt }
      case 'set-profile':
        return { ...phase, permissionProfile: edit.permissionProfile }
    }
  })
}
