import type { ApiResult } from '@qualy/web-runtime/api'
import type { assessmentApi } from '../api.ts'

// What the phase screens agree on: the row shape they edit, and the three
// regions a plan always has.
//
// Time is committed from the top of the plan down and withdrawn from the
// bottom up, so a plan is an entered prefix, then a scheduled prefix, then an
// unscheduled suffix. Every rule on these screens - which row may take a
// time, which may give one back, whose name may still change - is that shape
// read off in one place rather than re-derived per component.

export type PhaseDto = ApiResult<typeof assessmentApi, 'assessment', 'getPhases'>['phases'][number]
export type BatchDto = ApiResult<typeof assessmentApi, 'assessment', 'getBatch'>['batch']

/** the editable half of a phase: what it is, not when it happens */
export interface PhaseDraft {
  id?: string
  phaseKey: string
  displayName: string
  description: string
  /** what the phase waits on; read only while it has no time of its own */
  entryNote: string
  permissionProfile: readonly string[]
}

export const draftOf = (phase: PhaseDto): PhaseDraft => ({
  id: phase.id,
  phaseKey: phase.phaseKey,
  displayName: phase.displayName,
  description: phase.description,
  entryNote: phase.entryNote,
  permissionProfile: phase.permissionProfile,
})

/** a key no other phase in the plan uses yet */
export const freshKey = (taken: readonly { phaseKey: string }[]): string => {
  const used = new Set(taken.map((row) => row.phaseKey))
  let n = taken.length + 1
  while (used.has(`stage-${n}`)) n += 1
  return `stage-${n}`
}

export const freshDraft = (taken: readonly { phaseKey: string }[]): PhaseDraft => ({
  phaseKey: freshKey(taken),
  displayName: '',
  description: '',
  entryNote: '',
  permissionProfile: [],
})

export interface PlanShape {
  /** how many phases have actually begun */
  readonly entered: number
  /** how many have a time at all, entered or merely planned */
  readonly scheduled: number
  /** the phase in effect, or -1 before the batch begins */
  readonly currentIndex: number
  /** the one row that may take a time next, or -1 when none can */
  readonly frontier: number
  /** the one row that may give its time back, or -1 when none can */
  readonly tail: number
}

export const shapeOf = (rows: readonly PhaseDto[]): PlanShape => {
  const entered = rows.filter((row) => row.actualEntryAt !== null).length
  const scheduled = rows.filter(
    (row) => row.actualEntryAt !== null || row.plannedEntryAt !== null,
  ).length
  return {
    entered,
    scheduled,
    currentIndex: entered - 1,
    frontier: scheduled < rows.length ? scheduled : -1,
    tail: scheduled > entered ? scheduled - 1 : -1,
  }
}

/** how many drafts differ from what the server holds, additions included */
export const countChanges = (
  edited: readonly PhaseDraft[] | null,
  server: readonly PhaseDraft[],
): number => {
  if (edited === null) return 0
  const before = new Map(server.map((row) => [row.id!, row]))
  const changed = edited.filter(
    (row) => row.id === undefined || JSON.stringify(row) !== JSON.stringify(before.get(row.id)),
  ).length
  const kept = new Set(edited.flatMap((row) => (row.id !== undefined ? [row.id] : [])))
  return changed + server.filter((row) => !kept.has(row.id!)).length
}
