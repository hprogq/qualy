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
  /** the items it alone opens for filing; empty opens every item */
  itemScope: readonly string[]
  /** the roster rows it alone admits; empty admits everybody */
  participantScope: readonly string[]
}

export const draftOf = (phase: PhaseDto): PhaseDraft => ({
  id: phase.id,
  phaseKey: phase.phaseKey,
  displayName: phase.displayName,
  description: phase.description,
  entryNote: phase.entryNote,
  permissionProfile: phase.permissionProfile,
  itemScope: phase.itemScope,
  participantScope: phase.participantScope,
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
  itemScope: [],
  participantScope: [],
})

/** one allowance as a set, so the order ids were ticked in is not a change */
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

/**
 * What a save says about the two allowances of one row.
 *
 * Only what changed is sent. The server reads an absent allowance as "leave
 * it", so a row whose allowance nobody touched cannot be refused for it - an
 * ended stage keeps the allowance it ran under, and restating it, even
 * unchanged, is a write about a stage that is over.
 */
export const scopesToSend = (
  draft: PhaseDraft,
  stored: PhaseDraft | undefined,
): { itemScope?: readonly string[]; participantScope?: readonly string[] } => ({
  ...(stored === undefined
    ? draft.itemScope.length > 0
      ? { itemScope: draft.itemScope }
      : {}
    : sameSet(draft.itemScope, stored.itemScope)
      ? {}
      : { itemScope: draft.itemScope }),
  ...(stored === undefined
    ? draft.participantScope.length > 0
      ? { participantScope: draft.participantScope }
      : {}
    : sameSet(draft.participantScope, stored.participantScope)
      ? {}
      : { participantScope: draft.participantScope }),
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

/**
 * The shape of a plan, with the stage in hand taken from the server rather
 * than worked out here.
 *
 * Which stage is in hand is the clock's answer, and the server already gives
 * it. Counting the rows that have been written down instead said something
 * else twice over: for as long as a boundary that has passed waits to be
 * ratified - a second usually, minutes when a sweep is behind, indefinitely
 * while the scheduler is down - and, permanently, for a round that has been
 * archived or reopened, where the last stage that ran is not a stage in
 * hand at all. `scheduled` is untouched: ratification moves a time from one
 * column to the other and never changes whether there is one.
 */
export const shapeOf = (rows: readonly PhaseDto[], currentPhaseId: string | null): PlanShape => {
  const entered = rows.filter((row) => row.actualEntryAt !== null).length
  const scheduled = rows.filter(
    (row) => row.actualEntryAt !== null || row.plannedEntryAt !== null,
  ).length
  return {
    entered,
    scheduled,
    currentIndex: currentPhaseId === null ? -1 : rows.findIndex((row) => row.id === currentPhaseId),
    frontier: scheduled < rows.length ? scheduled : -1,
    tail: scheduled > entered ? scheduled - 1 : -1,
  }
}

/**
 * The stored stages an edit has put somewhere else in the plan.
 *
 * Measured against the order the kept stages already had: the longest run
 * of them still in that order stayed where it was, and whatever is outside
 * it is what moved. One stage taken from the top to the bottom is one move,
 * not every stage it passed on the way. Order is part of the plan - it is
 * the order the stages run in - so a move is as unsaved as a rename.
 *
 * Two neighbours swapped leave two runs as long as each other, one keeping
 * either stage. Which one moved is then the one somebody moved: `touched`
 * names the stages the reader pressed a move on, and the run that keeps the
 * untouched ones in place is taken.
 */
export const movedIds = (
  edited: readonly PhaseDraft[] | null,
  server: readonly PhaseDraft[],
  touched: ReadonlySet<string> = new Set(),
): ReadonlySet<string> => {
  if (edited === null) return new Set()
  const stored = new Set(server.flatMap((row) => (row.id !== undefined ? [row.id] : [])))
  const after = edited.flatMap((row) =>
    row.id !== undefined && stored.has(row.id) ? [row.id] : [],
  )
  const kept = new Set(after)
  const before = server.flatMap((row) => (row.id !== undefined && kept.has(row.id) ? [row.id] : []))
  // the longest common run, weighed so that length always wins and, between
  // runs of one length, the one holding more untouched stages does: a stage
  // counts one more than there are stages, and one more again if nobody
  // moved it. best[i][j] is the weight over the first i of `after` and the
  // first j of `before`. Each id is in each list once, so a pair that
  // matches is always worth taking.
  const whole = after.length + 1
  const weight = (id: string) => whole + (touched.has(id) ? 0 : 1)
  const best = Array.from({ length: after.length + 1 }, () =>
    Array.from<number>({ length: before.length + 1 }).fill(0),
  )
  for (let i = 1; i <= after.length; i += 1) {
    for (let j = 1; j <= before.length; j += 1) {
      best[i]![j] =
        after[i - 1] === before[j - 1]
          ? best[i - 1]![j - 1]! + weight(after[i - 1]!)
          : Math.max(best[i - 1]![j]!, best[i]![j - 1]!)
    }
  }
  const moved = new Set(after)
  let i = after.length
  let j = before.length
  while (i > 0 && j > 0) {
    if (after[i - 1] === before[j - 1]) {
      moved.delete(after[i - 1]!)
      i -= 1
      j -= 1
    } else if (best[i - 1]![j]! >= best[i]![j - 1]!) {
      i -= 1
    } else {
      j -= 1
    }
  }
  return moved
}

/** how many stages differ from what the server holds: additions, removals and moves included */
export const countChanges = (
  edited: readonly PhaseDraft[] | null,
  server: readonly PhaseDraft[],
  touched?: ReadonlySet<string>,
): number => {
  if (edited === null) return 0
  const before = new Map(server.map((row) => [row.id!, row]))
  const moved = movedIds(edited, server, touched)
  const changed = edited.filter(
    (row) => row.id === undefined || edits(row, before.get(row.id)) || moved.has(row.id),
  ).length
  const kept = new Set(edited.flatMap((row) => (row.id !== undefined ? [row.id] : [])))
  return changed + server.filter((row) => !kept.has(row.id!)).length
}

/** whether a row says something other than what is stored for it */
export const edits = (row: PhaseDraft, stored: PhaseDraft | undefined): boolean =>
  stored === undefined ||
  row.displayName !== stored.displayName ||
  row.description !== stored.description ||
  row.entryNote !== stored.entryNote ||
  !sameSet(row.permissionProfile, stored.permissionProfile) ||
  !sameSet(row.itemScope, stored.itemScope) ||
  !sameSet(row.participantScope, stored.participantScope)
