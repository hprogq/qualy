import { PHASE_GATED } from '../../permissions.ts'
import { boundPublication, effectiveState } from './queue.ts'
import {
  offsetMillis,
  type EntryOffset,
  type EntryTrigger,
  type EpochMillis,
  type PhasePlan,
  type PhaseSnapshot,
  type PublicationLookup,
} from './types.ts'

// The plan editing rules, as structured verdicts rather than booleans: the
// service refuses with these reasons and the ui explains them, so the enum is
// defined once here and consumed everywhere.
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
  | 'planned-on-publication-phase'
  | 'hard-plan-beyond-event-boundary'
  | 'planned-not-in-future'
  | 'planned-out-of-order'
  | 'offset-not-positive'
  | 'offset-on-non-scheduled-phase'
  | 'binding-on-non-publication-phase'
  | 'binding-immutable-after-entry'
  | 'profile-code-not-gated'
  | 'insert-not-after-current'
  | 'insert-after-terminal'
  | 'terminal-must-be-manual'

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
  | {
      readonly kind: 'set-planned'
      readonly phaseId: string
      readonly plannedEntryAt: EpochMillis | null
    }
  | {
      readonly kind: 'set-offset'
      readonly phaseId: string
      readonly entryOffset: EntryOffset | null
    }
  | {
      readonly kind: 'set-estimated'
      readonly phaseId: string
      readonly estimatedEntryAt: EpochMillis | null
    }
  | { readonly kind: 'set-actual'; readonly phaseId: string; readonly actualEntryAt: EpochMillis }
  | {
      readonly kind: 'set-profile'
      readonly phaseId: string
      readonly permissionProfile: readonly string[]
    }
  | {
      readonly kind: 'bind-publication'
      readonly phaseId: string
      readonly publicationId: string | null
    }

/** what a plan insertion states; it is born unbound and unentered by shape */
export interface NewPhaseSpec {
  readonly phaseKey: string
  readonly displayName: string
  readonly entryTrigger: EntryTrigger
  readonly plannedEntryAt?: EpochMillis | null
  readonly entryOffset?: EntryOffset | null
  readonly estimatedEntryAt?: EpochMillis | null
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

const viewOf = (plan: PhasePlan, publications: PublicationLookup, now: EpochMillis): PlanView => {
  const state = effectiveState(plan, publications, now)
  const enteredAt = new Map<string, EpochMillis>()
  for (const phase of plan) {
    if (phase.actualEntryAt !== null) enteredAt.set(phase.id, phase.actualEntryAt)
  }
  for (const pending of state.pending) enteredAt.set(pending.phaseId, pending.actualEntryAt)
  return { effectiveIndex: state.index, enteredAt }
}

/**
 * The instant a phase is committed to enter at, if any: its (possibly
 * pending) entry, a scheduled plan, or an armed publication's promise. A
 * manual boundary's planned time is an SLA and commits nothing.
 */
const committedInstant = (
  phase: PhaseSnapshot,
  publications: PublicationLookup,
  view: PlanView,
): EpochMillis | null => {
  const entered = view.enteredAt.get(phase.id)
  if (entered !== undefined) return entered
  if (phase.entryTrigger === 'scheduled') return phase.plannedEntryAt
  if (phase.entryTrigger === 'publication') {
    const ref = boundPublication(phase, publications)
    if (ref !== null && (ref.status === 'scheduled' || ref.status === 'published')) {
      return ref.publishAt
    }
  }
  return null
}

/**
 * A hard plan is a promise that fires by itself, so it may not sit beyond a
 * boundary that still needs an event: an unfired manual one, or a publication
 * one without a committed instant. §10 words the rule for the manual case;
 * an unarmed publication boundary withholds a date for exactly the same
 * reason, so it blocks the same way.
 */
const eventGateBefore = (
  plan: PhasePlan,
  publications: PublicationLookup,
  view: PlanView,
  index: number,
): PhaseSnapshot | null => {
  for (let i = 0; i < index; i++) {
    const phase = plan[i]!
    if (view.enteredAt.has(phase.id)) continue
    if (phase.entryTrigger === 'manual') return phase
    if (phase.entryTrigger === 'publication') {
      const ref = boundPublication(phase, publications)
      if (ref === null || (ref.status !== 'scheduled' && ref.status !== 'published')) return phase
    }
  }
  return null
}

const plannedRefusals = (
  plan: PhasePlan,
  publications: PublicationLookup,
  now: EpochMillis,
  view: PlanView,
  index: number,
  planned: EpochMillis | null,
): EditRefusal[] => {
  const phase = plan[index]!
  if (phase.entryTrigger === 'publication') {
    // the display time of a publication boundary has a single source, the
    // publication's own publish_at; a copy here could only fall out of sync
    return [{ reason: 'planned-on-publication-phase', phaseId: phase.id }]
  }
  if (planned === null) return []
  const refusals: EditRefusal[] = []
  if (planned <= now) refusals.push({ reason: 'planned-not-in-future', phaseId: phase.id })
  if (phase.entryTrigger === 'scheduled') {
    const gate = eventGateBefore(plan, publications, view, index)
    if (gate !== null) {
      refusals.push({
        reason: 'hard-plan-beyond-event-boundary',
        phaseId: phase.id,
        blockingPhaseId: gate.id,
      })
    }
    // boundaries fire in queue order, so committed instants must be ordered:
    // a plan earlier than an upstream commitment or later than a downstream
    // one would derive an empty or negative interval
    for (let i = 0; i < plan.length; i++) {
      if (i === index) continue
      const other = committedInstant(plan[i]!, publications, view)
      if (other === null) continue
      if ((i < index && other >= planned) || (i > index && other <= planned)) {
        refusals.push({
          reason: 'planned-out-of-order',
          phaseId: phase.id,
          blockingPhaseId: plan[i]!.id,
        })
      }
    }
  }
  return refusals
}

const offsetRefusals = (phase: PhaseSnapshot, offset: EntryOffset | null): EditRefusal[] => {
  if (phase.entryTrigger !== 'scheduled') {
    return [{ reason: 'offset-on-non-scheduled-phase', phaseId: phase.id }]
  }
  if (offset === null) return []
  const parts = [offset.days ?? 0, offset.hours ?? 0, offset.minutes ?? 0]
  if (parts.some((part) => !Number.isFinite(part) || part < 0) || offsetMillis(offset) <= 0) {
    return [{ reason: 'offset-not-positive', phaseId: phase.id }]
  }
  return []
}

const profileReview = (phaseId: string | null, profile: readonly string[]): EditReview => {
  const refusals: EditRefusal[] = []
  for (const code of profile) {
    // the phase editor's vocabulary is exactly the gate's registry; a code
    // outside it is a configuration error, not a wider grant
    if (!PHASE_GATED.has(code)) refusals.push({ reason: 'profile-code-not-gated', phaseId, code })
  }
  const warnings: EditWarning[] = []
  if (profile.includes('assessment.entry.proxy') && !profile.includes('assessment.entry.submit')) {
    // proxy is submitting on a student's behalf; a phase where they could
    // not submit themselves is suspect enough to say so, not enough to block
    warnings.push({ reason: 'proxy-without-submit', phaseId })
  }
  return { refusals, warnings }
}

export function reviewPlanEdit(
  plan: PhasePlan,
  publications: PublicationLookup,
  now: EpochMillis,
  edit: PlanEdit,
): EditReview {
  const index = plan.findIndex((phase) => phase.id === edit.phaseId)
  if (index === -1) return refuse([{ reason: 'phase-not-found', phaseId: edit.phaseId }])
  const phase = plan[index]!
  const view = viewOf(plan, publications, now)
  const entered = view.enteredAt.has(phase.id)
  const ended = index < view.effectiveIndex

  switch (edit.kind) {
    case 'rename':
      return edit.displayName.trim() === ''
        ? refuse([{ reason: 'display-name-blank', phaseId: phase.id }])
        : ok()
    case 'set-actual':
      // actuals are written by transitions and by nothing else; the past is
      // not an editable field
      return refuse([{ reason: 'actual-immutable', phaseId: phase.id }])
    case 'set-planned': {
      if (entered) return refuse([{ reason: 'phase-already-entered', phaseId: phase.id }])
      return refuse(plannedRefusals(plan, publications, now, view, index, edit.plannedEntryAt))
    }
    case 'set-offset': {
      if (entered) return refuse([{ reason: 'phase-already-entered', phaseId: phase.id }])
      return refuse(offsetRefusals(phase, edit.entryOffset))
    }
    case 'set-estimated':
      return entered ? refuse([{ reason: 'phase-already-entered', phaseId: phase.id }]) : ok()
    case 'bind-publication': {
      if (phase.entryTrigger !== 'publication') {
        return refuse([{ reason: 'binding-on-non-publication-phase', phaseId: phase.id }])
      }
      // rebinding while unentered is legitimate (§32.26); once the boundary
      // fired, which publication opened it is a historical fact
      return entered
        ? refuse([{ reason: 'binding-immutable-after-entry', phaseId: phase.id }])
        : ok()
    }
    case 'set-profile': {
      if (ended) return refuse([{ reason: 'ended-phase-name-only', phaseId: phase.id }])
      return profileReview(phase.id, edit.permissionProfile)
    }
  }
}

/**
 * Where a new phase may land: strictly after the phase in effect, and never
 * after the terminal one - the plan ends with the archive phase, and nothing
 * comes after the archive.
 */
export function reviewInsertion(
  plan: PhasePlan,
  publications: PublicationLookup,
  now: EpochMillis,
  position: number,
  spec: NewPhaseSpec,
): EditReview {
  const view = viewOf(plan, publications, now)
  const refusals: EditRefusal[] = []
  if (position <= view.effectiveIndex) {
    refusals.push({ reason: 'insert-not-after-current', phaseId: null })
  }
  if (plan.length > 0 && position >= plan.length) {
    refusals.push({ reason: 'insert-after-terminal', phaseId: null })
  }
  if (spec.displayName.trim() === '') {
    refusals.push({ reason: 'display-name-blank', phaseId: null })
  }
  if (refusals.length > 0) return refuse(refusals)

  // field rules are the edit rules, asked against the plan as it would be
  const inserted: PhaseSnapshot = {
    id: '__inserted__',
    ordinal: Number.NaN,
    phaseKey: spec.phaseKey,
    displayName: spec.displayName,
    entryTrigger: spec.entryTrigger,
    plannedEntryAt: null,
    actualEntryAt: null,
    entryOffset: null,
    estimatedEntryAt: spec.estimatedEntryAt ?? null,
    opensPublicationId: null,
    permissionProfile: spec.permissionProfile ?? [],
  }
  const hypothetical = [...plan.slice(0, position), inserted, ...plan.slice(position)]
  if (spec.plannedEntryAt != null) {
    refusals.push(
      ...plannedRefusals(hypothetical, publications, now, view, position, spec.plannedEntryAt).map(
        (refusal) => ({ ...refusal, phaseId: null }),
      ),
    )
  }
  if (spec.entryOffset != null) {
    refusals.push(
      ...offsetRefusals(inserted, spec.entryOffset).map((refusal) => ({
        ...refusal,
        phaseId: null,
      })),
    )
  }
  const profile = profileReview(null, spec.permissionProfile ?? [])
  refusals.push(...profile.refusals)
  return { refusals, warnings: profile.warnings }
}

export interface InsertionPlacement {
  /** the ordinal the new phase takes */
  readonly ordinal: number
  /** existing phases whose ordinal shifts up, in plan order */
  readonly shifted: readonly { readonly phaseId: string; readonly ordinal: number }[]
}

/** the ordinal arithmetic of an insertion the review already accepted */
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

/** plan-level shape a template or activation must satisfy */
export function reviewPlanShape(plan: PhasePlan): EditReview {
  if (plan.length > 0 && plan[plan.length - 1]!.entryTrigger !== 'manual') {
    // the archive close-out is a human decision; a plan whose last boundary
    // can fire on its own has no terminal at all
    return refuse([{ reason: 'terminal-must-be-manual', phaseId: plan[plan.length - 1]!.id }])
  }
  return ok()
}

/**
 * A whole plan of unentered specs, reviewed at once - what a draft rewrite or
 * a template application submits.
 *
 * With `now` the clock rules apply too: planned instants must be future,
 * ordered, and on the prefix before the first event gate. With `now` null
 * only the structural rules run - a template is data, and refusing to save
 * one in October because it names September would make templates rot.
 */
export function reviewPlan(specs: readonly NewPhaseSpec[], now: EpochMillis | null): EditReview {
  const plan: PhaseSnapshot[] = specs.map((spec, index) => ({
    id: `#${index}`,
    ordinal: index,
    phaseKey: spec.phaseKey,
    displayName: spec.displayName,
    entryTrigger: spec.entryTrigger,
    plannedEntryAt: spec.plannedEntryAt ?? null,
    actualEntryAt: null,
    entryOffset: spec.entryOffset ?? null,
    estimatedEntryAt: spec.estimatedEntryAt ?? null,
    opensPublicationId: null,
    permissionProfile: spec.permissionProfile ?? [],
  }))
  const publications = new Map<string, never>()
  const view = viewOf(plan, publications, now ?? 0)
  const at = (index: number) => ({ index })

  const refusals: EditRefusal[] = []
  const warnings: EditWarning[] = []
  const shape = reviewPlanShape(plan)
  refusals.push(...shape.refusals.map((r) => ({ ...r, phaseId: null, ...at(plan.length - 1) })))

  plan.forEach((phase, index) => {
    if (phase.displayName.trim() === '') {
      refusals.push({ reason: 'display-name-blank', phaseId: null, ...at(index) })
    }
    if (phase.plannedEntryAt !== null) {
      const planned =
        now !== null
          ? plannedRefusals(plan, publications, now, view, index, phase.plannedEntryAt)
          : phase.entryTrigger === 'publication'
            ? [{ reason: 'planned-on-publication-phase' as const, phaseId: phase.id }]
            : []
      refusals.push(...planned.map((r) => ({ ...r, phaseId: null, ...at(index) })))
    }
    if (phase.entryOffset !== null) {
      refusals.push(
        ...offsetRefusals(phase, phase.entryOffset).map((r) => ({
          ...r,
          phaseId: null,
          ...at(index),
        })),
      )
    }
    const profile = profileReview(null, phase.permissionProfile)
    refusals.push(...profile.refusals.map((r) => ({ ...r, ...at(index) })))
    warnings.push(...profile.warnings.map((w) => ({ ...w, ...at(index) })))
  })
  return { refusals, warnings }
}
