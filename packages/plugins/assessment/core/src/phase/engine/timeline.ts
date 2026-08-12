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
 * @param inEffect which stage is in hand, or `null` when none is.
 *
 * A round can have no present: an archived one is over, and one reopened for
 * a date still to come is between stages. Neither is "everything has ended" -
 * a stage the round has not reached is still to come whether or not the round
 * is running today, and marking it ended would say it had happened.
 */
export function deriveTimeline(
  plan: PhasePlan,
  now: EpochMillis,
  inEffect: number | null | undefined = undefined,
): readonly TimelineEntry[] {
  const state = effectiveState(plan, now)
  const pendingAt = new Map(state.pending.map((p) => [p.phaseId, p.actualEntryAt]))
  // undefined is "ask the clock", which is what a caller with no opinion
  // means; null is "nothing is in hand", which only the lifecycle knows
  const here = inEffect === undefined ? state.index : inEffect

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
      // with nothing in hand, what has happened is behind and the rest is
      // ahead: the entry itself is what says which
      status:
        here === null
          ? entry.kind === 'entered'
            ? 'ended'
            : 'future'
          : index < here
            ? 'ended'
            : index === here
              ? 'current'
              : 'future',
      entry,
    }
  })
}
