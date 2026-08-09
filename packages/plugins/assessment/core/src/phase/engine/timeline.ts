import { boundPublication, effectiveState } from './queue.ts'
import type { EpochMillis, PhasePlan, PublicationLookup } from './types.ts'

// The student-facing timeline, derived with the §10 priority fixed once:
// actual (it happened) > an armed scheduled plan (it is definite) > a bound
// publication's promise (it is announced) > an estimate (roughly) > pending.
// The timeline is honest at every instant: calendar segments are definite,
// event segments light up as their events land - and a manual boundary's
// planned time is an internal SLA, so it never surfaces here as a promise.

export type TimelineTime =
  | { readonly kind: 'entered'; readonly at: EpochMillis }
  | { readonly kind: 'planned'; readonly at: EpochMillis }
  | { readonly kind: 'announced'; readonly at: EpochMillis }
  | { readonly kind: 'estimated'; readonly at: EpochMillis }
  | { readonly kind: 'pending' }

export interface TimelineEntry {
  readonly phaseId: string
  readonly phaseKey: string
  readonly displayName: string
  readonly status: 'ended' | 'current' | 'future'
  readonly entry: TimelineTime
}

export function deriveTimeline(
  plan: PhasePlan,
  publications: PublicationLookup,
  now: EpochMillis,
): readonly TimelineEntry[] {
  const state = effectiveState(plan, publications, now)
  const pendingAt = new Map(state.pending.map((p) => [p.phaseId, p.actualEntryAt]))

  return plan.map((phase, index) => {
    const enteredAt = phase.actualEntryAt ?? pendingAt.get(phase.id) ?? null
    const entry = ((): TimelineTime => {
      if (enteredAt !== null) return { kind: 'entered', at: enteredAt }
      if (phase.entryTrigger === 'scheduled' && phase.plannedEntryAt !== null) {
        return { kind: 'planned', at: phase.plannedEntryAt }
      }
      if (phase.entryTrigger === 'publication') {
        const ref = boundPublication(phase, publications)
        if (
          ref !== null &&
          (ref.status === 'scheduled' || ref.status === 'published') &&
          ref.publishAt !== null
        ) {
          return { kind: 'announced', at: ref.publishAt }
        }
      }
      if (phase.estimatedEntryAt !== null) return { kind: 'estimated', at: phase.estimatedEntryAt }
      return { kind: 'pending' }
    })()
    return {
      phaseId: phase.id,
      phaseKey: phase.phaseKey,
      displayName: phase.displayName,
      status: index < state.index ? 'ended' : index === state.index ? 'current' : 'future',
      entry,
    }
  })
}
