import type {
  EntryTrigger,
  EpochMillis,
  PhasePlan,
  PhaseSnapshot,
  PublicationLookup,
  PublicationRef,
} from './types.ts'

// The timeline is a queue, and the clock - not the scheduler - decides what
// phase a batch is in. effectiveState walks boundaries the way §10 words it:
// starting from the last materialized phase, a next boundary counts as
// crossed when it is scheduled with its planned instant passed, or a
// publication boundary whose bound publication is effective. Materialization
// only ratifies; a scheduler down for seven minutes changes nothing about
// whether the 00:00 deadline had passed at 00:03.

/**
 * Sorts by ordinal and refuses corrupt shapes: duplicate ordinals, or an
 * entered phase after an unentered one. Both indicate broken writes, and an
 * engine answering questions from a broken plan would answer them wrong.
 */
export function normalizePlan(rows: readonly PhaseSnapshot[]): PhasePlan {
  const plan = [...rows].sort((a, b) => a.ordinal - b.ordinal)
  for (let i = 1; i < plan.length; i++) {
    if (plan[i]!.ordinal === plan[i - 1]!.ordinal) {
      throw new Error(`phase plan is corrupt: duplicate ordinal ${plan[i]!.ordinal}`)
    }
    if (plan[i]!.actualEntryAt !== null && plan[i - 1]!.actualEntryAt === null) {
      throw new Error(
        `phase plan is corrupt: phase ${plan[i]!.id} entered while an earlier phase has not`,
      )
    }
  }
  return plan
}

/** index of the last materialized phase; -1 before the first boundary fires */
export function materializedIndex(plan: PhasePlan): number {
  let index = -1
  for (const phase of plan) {
    if (phase.actualEntryAt === null) break
    index++
  }
  return index
}

/** the publication a boundary is bound to; corrupt input throws, unbound is null */
export function boundPublication(
  phase: PhaseSnapshot,
  publications: PublicationLookup,
): PublicationRef | null {
  if (phase.opensPublicationId === null) return null
  const ref = publications.get(phase.opensPublicationId)
  if (!ref) {
    throw new Error(
      `phase ${phase.id} is bound to publication ${phase.opensPublicationId}, which the caller did not provide`,
    )
  }
  return ref
}

/**
 * Effective for entry purposes: PUBLISHED, or SCHEDULED whose promised
 * instant has passed and merely awaits materialization (§17).
 */
export function isPublicationEffective(ref: PublicationRef, now: EpochMillis): boolean {
  if (ref.status === 'published') return true
  return ref.status === 'scheduled' && ref.publishAt !== null && now >= ref.publishAt
}

/** the promised instant of a publication that can still deliver on it */
const committedPublishAt = (ref: PublicationRef): EpochMillis | null => {
  if (ref.status !== 'scheduled' && ref.status !== 'published') return null
  if (ref.publishAt === null) {
    // a scheduled or published publication without its instant is corrupt:
    // both states are defined by having promised one
    throw new Error(`a ${ref.status} publication is missing its publish_at`)
  }
  return ref.publishAt
}

/**
 * The semantic instant a boundary fires at when the clock alone decides, or
 * null while it cannot fire. Manual boundaries never do - a planned time on
 * one is an SLA, advisory by definition (§32.11).
 */
const fireInstant = (
  phase: PhaseSnapshot,
  publications: PublicationLookup,
  now: EpochMillis,
): EpochMillis | null => {
  if (phase.entryTrigger === 'scheduled') {
    return phase.plannedEntryAt !== null && now >= phase.plannedEntryAt
      ? phase.plannedEntryAt
      : null
  }
  if (phase.entryTrigger === 'publication') {
    const ref = boundPublication(phase, publications)
    if (ref === null) return null
    const promised = committedPublishAt(ref)
    return promised !== null && now >= promised ? promised : null
  }
  return null
}

/** a boundary crossed by the clock but not yet written back as actual */
export interface PendingTransition {
  readonly phaseId: string
  readonly trigger: EntryTrigger
  /** what actual_entry_at must be set to: the semantic instant, never "now" */
  readonly actualEntryAt: EpochMillis
}

export interface EffectiveState {
  /** index of the phase in effect at `now`; -1 before the first boundary */
  readonly index: number
  readonly phase: PhaseSnapshot | null
  /**
   * Boundaries to ratify, in queue order. Empty once materialization caught
   * up, which is what makes the scheduler's scan idempotent.
   */
  readonly pending: readonly PendingTransition[]
}

export function effectiveState(
  plan: PhasePlan,
  publications: PublicationLookup,
  now: EpochMillis,
): EffectiveState {
  let index = materializedIndex(plan)
  const pending: PendingTransition[] = []
  while (index + 1 < plan.length) {
    const next = plan[index + 1]!
    const at = fireInstant(next, publications, now)
    if (at === null) break
    pending.push({ phaseId: next.id, trigger: next.entryTrigger, actualEntryAt: at })
    index++
  }
  return { index, phase: index >= 0 ? (plan[index] ?? null) : null, pending }
}

/**
 * The armed prefix: boundaries from the queue head that will fire without
 * further human action - scheduled ones carrying a planned instant, and
 * publication ones bound to a publication that promised its instant. The
 * walk stops at the first boundary that cannot fire on its own: a manual
 * one, an unplanned scheduled one, or an unbound / unscheduled publication.
 * Nothing beyond the prefix ever self-ignites.
 */
export function armedPrefix(plan: PhasePlan, publications: PublicationLookup): PhasePlan {
  const armed: PhaseSnapshot[] = []
  for (let i = materializedIndex(plan) + 1; i < plan.length; i++) {
    const phase = plan[i]!
    if (phase.entryTrigger === 'scheduled') {
      if (phase.plannedEntryAt === null) break
      armed.push(phase)
      continue
    }
    if (phase.entryTrigger === 'publication') {
      const ref = boundPublication(phase, publications)
      if (ref === null || committedPublishAt(ref) === null) break
      armed.push(phase)
      continue
    }
    break
  }
  return armed
}
