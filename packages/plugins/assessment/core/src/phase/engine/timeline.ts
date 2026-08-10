import { effectiveState } from './queue.ts'
import type { EpochMillis, PhasePlan } from './types.ts'

// The student-facing timeline. With the model down to "has a time or does
// not", the §10 priority ladder collapses to two rungs: what happened, then
// what is due to happen. A phase with neither is simply not scheduled yet,
// and the description is what a screen shows in its place.

export type TimelineTime =
  | { readonly kind: 'entered'; readonly at: EpochMillis }
  | { readonly kind: 'planned'; readonly at: EpochMillis }
  | { readonly kind: 'pending' }

export interface TimelineEntry {
  readonly phaseId: string
  readonly phaseKey: string
  readonly displayName: string
  readonly description: string
  readonly status: 'ended' | 'current' | 'future'
  readonly entry: TimelineTime
}

export function deriveTimeline(plan: PhasePlan, now: EpochMillis): readonly TimelineEntry[] {
  const state = effectiveState(plan, now)
  const pendingAt = new Map(state.pending.map((p) => [p.phaseId, p.actualEntryAt]))

  return plan.map((phase, index) => {
    const enteredAt = phase.actualEntryAt ?? pendingAt.get(phase.id) ?? null
    const entry: TimelineTime =
      enteredAt !== null
        ? { kind: 'entered', at: enteredAt }
        : phase.plannedEntryAt !== null
          ? { kind: 'planned', at: phase.plannedEntryAt }
          : { kind: 'pending' }
    return {
      phaseId: phase.id,
      phaseKey: phase.phaseKey,
      displayName: phase.displayName,
      description: phase.description,
      status: index < state.index ? 'ended' : index === state.index ? 'current' : 'future',
      entry,
    }
  })
}
