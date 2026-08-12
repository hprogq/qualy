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
  /** what the phase is waiting for; only ever set while it has no time */
  readonly entryNote: string
  readonly status: 'ended' | 'current' | 'future'
  readonly entry: TimelineTime
}

/**
 * @param running whether the batch is in service. A round that has been
 * archived has no stage in effect: leaving its last one marked as current
 * says the round is still going, on every card and in every bar that reads
 * this, and would make a stage's profile the live one again the moment the
 * round was reopened for a future date.
 */
export function deriveTimeline(
  plan: PhasePlan,
  now: EpochMillis,
  running = true,
): readonly TimelineEntry[] {
  const state = effectiveState(plan, now)
  const pendingAt = new Map(state.pending.map((p) => [p.phaseId, p.actualEntryAt]))
  // everything that happened is behind it, and nothing is in hand
  const here = running ? state.index : plan.length

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
      // a note about waiting is answered by the time itself; keeping it after
      // one is set would leave the plan explaining a decision it has made
      entryNote: entry.kind === 'pending' ? phase.entryNote : '',
      status: index < here ? 'ended' : index === here ? 'current' : 'future',
      entry,
    }
  })
}
