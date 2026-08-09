import { boundPublication } from './queue.ts'
import {
  offsetMillis,
  type EpochMillis,
  type PhasePlan,
  type PhaseSnapshot,
  type PublicationLookup,
} from './types.ts'

// Offset materialization, worded exactly as §32.34 rules it: an offset may
// become a planned time the moment its anchor's semantic instant is
// determined - a boundary that fired (actual), or a publication that
// promised its instant by reaching SCHEDULED. A merely planned upstream
// boundary determines nothing: its plan can still move.

/** the instant an offset on the following phase may anchor on, if determined */
const anchorInstant = (
  phase: PhaseSnapshot,
  publications: PublicationLookup,
): EpochMillis | null => {
  if (phase.actualEntryAt !== null) return phase.actualEntryAt
  if (phase.entryTrigger === 'publication') {
    const ref = boundPublication(phase, publications)
    if (ref !== null && (ref.status === 'scheduled' || ref.status === 'published')) {
      return ref.publishAt
    }
  }
  return null
}

export interface PlannedMaterialization {
  readonly phaseId: string
  readonly plannedEntryAt: EpochMillis
}

/**
 * Every offset whose anchor is now determined, turned into a planned entry.
 *
 * Deliberately one step deep: a planned time produced here is still a plan,
 * so it determines nothing for the offset after it - chains materialize as
 * their boundaries actually fire. Callers run this after any event that
 * determines an instant (a manual advance, a publication schedule) and write
 * the updates back.
 *
 * A materialization landing at or before its anchor is corrupt input - the
 * validators refuse non-positive offsets - and throws rather than silently
 * compressing a phase to nothing.
 */
export function materializeOffsets(
  plan: PhasePlan,
  publications: PublicationLookup,
): readonly PlannedMaterialization[] {
  const updates: PlannedMaterialization[] = []
  for (let i = 1; i < plan.length; i++) {
    const phase = plan[i]!
    if (phase.entryTrigger !== 'scheduled') continue
    if (phase.actualEntryAt !== null || phase.plannedEntryAt !== null) continue
    if (phase.entryOffset === null) continue
    const anchor = anchorInstant(plan[i - 1]!, publications)
    if (anchor === null) continue
    const planned = anchor + offsetMillis(phase.entryOffset)
    if (planned <= anchor) {
      throw new Error(`phase ${phase.id} has a non-positive entry offset`)
    }
    updates.push({ phaseId: phase.id, plannedEntryAt: planned })
  }
  return updates
}

export interface PlannedClearance {
  readonly phaseId: string
  readonly plannedEntryAt: null
}

/**
 * What "cancelling returns the downstream to 待定" means mechanically: when a
 * boundary's commitment is withdrawn (a publication cancelled or retracted),
 * every offset-derived plan below it is cleared. Only derived plans qualify -
 * a hand-set hard plan was the administrator's own statement, and only exists
 * on the prefix the validators allow it on.
 */
export function clearDerivedPlansBelow(
  plan: PhasePlan,
  index: number,
): readonly PlannedClearance[] {
  const updates: PlannedClearance[] = []
  for (let i = index + 1; i < plan.length; i++) {
    const phase = plan[i]!
    if (phase.actualEntryAt !== null) continue
    if (phase.entryOffset === null || phase.plannedEntryAt === null) continue
    updates.push({ phaseId: phase.id, plannedEntryAt: null })
  }
  return updates
}
