import type { EpochMillis, PhasePlan, PhaseSnapshot } from './types.ts'

// The timeline is a queue, and the clock - not the scheduler - decides what
// phase a batch is in. effectiveState walks boundaries the way §10 words it:
// starting from the last materialized phase, a next boundary counts as
// crossed when its planned instant has passed. Materialization only ratifies;
// a scheduler down for seven minutes changes nothing about whether the 00:00
// deadline had passed at 00:03.

/**
 * Sorts by ordinal and refuses corrupt shapes: duplicate ordinals, an entered
 * phase after an unentered one, or a scheduled phase after an unscheduled
 * one. All three indicate broken writes, and an engine answering questions
 * from a broken plan would answer them wrong.
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
    if (plan[i]!.plannedEntryAt !== null && !isScheduled(plan[i - 1]!)) {
      throw new Error(
        `phase plan is corrupt: phase ${plan[i]!.id} is scheduled while an earlier phase is not`,
      )
    }
  }
  return plan
}

/** a phase is scheduled once it has a time, however that time was decided */
export const isScheduled = (phase: PhaseSnapshot): boolean =>
  phase.actualEntryAt !== null || phase.plannedEntryAt !== null

/** index of the last materialized phase; -1 before the first boundary fires */
export function materializedIndex(plan: PhasePlan): number {
  let index = -1
  for (const phase of plan) {
    if (phase.actualEntryAt === null) break
    index++
  }
  return index
}

/**
 * Index of the last phase that has a time at all - entered or merely planned.
 * Everything after it is the unscheduled suffix, which is the only part of a
 * plan whose structure may still change.
 */
export function scheduledIndex(plan: PhasePlan): number {
  let index = -1
  for (const phase of plan) {
    if (!isScheduled(phase)) break
    index++
  }
  return index
}

/** a boundary crossed by the clock but not yet written back as actual */
export interface PendingTransition {
  readonly phaseId: string
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

export function effectiveState(plan: PhasePlan, now: EpochMillis): EffectiveState {
  let index = materializedIndex(plan)
  const pending: PendingTransition[] = []
  while (index + 1 < plan.length) {
    const next = plan[index + 1]!
    if (next.plannedEntryAt === null || now < next.plannedEntryAt) break
    pending.push({ phaseId: next.id, actualEntryAt: next.plannedEntryAt })
    index++
  }
  return { index, phase: index >= 0 ? (plan[index] ?? null) : null, pending }
}

/**
 * The armed prefix: boundaries from the queue head that will fire without
 * further human action. With planned instants forming a prefix, that is
 * simply every phase between the queue head and the last scheduled one.
 */
export function armedPrefix(plan: PhasePlan): PhasePlan {
  return plan.slice(materializedIndex(plan) + 1, scheduledIndex(plan) + 1)
}
