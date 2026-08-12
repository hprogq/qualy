import type { TimelineLike } from './progress.ts'

// The round as the people in it read it: a run of stages, one of them now.
//
// Everything here is read-only and says nothing about how a plan is built.
// A stage nobody has scheduled yet has no date, and that is all a participant
// is told - "not scheduled" is a sentence about the administrator's work, and
// it belongs on the page where that work is done.

export interface FlowStage {
  readonly id: string
  readonly name: string
  readonly status: 'ended' | 'current' | 'future'
  /** when it began, or is due to; absent when nothing has been fixed */
  readonly at: number | null
  /** when it gives way to the next one, which is the next one's start */
  readonly until: number | null
}

/** the plan as stages with both of their edges filled in */
export const stagesOf = (timeline: readonly TimelineLike[]): readonly FlowStage[] =>
  timeline.map((entry, index) => {
    const next = timeline[index + 1]
    const at = entry.entry.at === null ? null : Date.parse(entry.entry.at)
    const until = next?.entry.at == null ? null : Date.parse(next.entry.at)
    return {
      id: `${entry.displayName}:${String(index)}`,
      name: entry.displayName,
      status: entry.status,
      at: at !== null && Number.isNaN(at) ? null : at,
      until: until !== null && Number.isNaN(until) ? null : until,
    }
  })

export const currentOf = (stages: readonly FlowStage[]): FlowStage | undefined =>
  stages.find((stage) => stage.status === 'current')
