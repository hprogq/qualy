// When reviewing is open in a round, read off its timeline.
//
// A reviewer's clock is not a stage's clock: two stages in a row may both
// open reviewing, and then the window runs to the end of the second, not
// the first. What closes it is the first stage after the run that does not
// open reviewing; what opens it is the first stage ahead that does.

/** the part of a timeline stage this reading needs */
export interface WindowStage {
  readonly displayName: string
  readonly status: 'ended' | 'current' | 'future'
  readonly entry: { readonly kind: 'entered' | 'planned' | 'pending'; readonly at: string | null }
  readonly reviewing: boolean
}

export type ReviewWindow =
  /** open now, closing at a known instant */
  | {
      readonly kind: 'closes'
      readonly stage: string
      /** when the run of reviewing stages began, where it is known */
      readonly since: number | null
      readonly at: number
      /** when it opens again after closing, where a later stage says so */
      readonly reopens: number | null
    }
  /** open now, closing at the end of a reviewing stage without a known end time */
  | { readonly kind: 'closes-with'; readonly stage: string; readonly endStage: string }
  /** open now, and no stage ahead closes it */
  | { readonly kind: 'stays-open'; readonly stage: string }
  /** shut now, opening at a known instant */
  | { readonly kind: 'opens'; readonly at: number }
  /** shut now, opening when a stage without a time yet begins */
  | { readonly kind: 'opens-with'; readonly opener: string }
  /** shut now, and every stage that opened it is behind the round */
  | { readonly kind: 'ended' }
  /** no stage of the round opens reviewing */
  | { readonly kind: 'none' }

const instantOf = (stage: WindowStage): number | null =>
  stage.entry.at === null ? null : Date.parse(stage.entry.at)

export const reviewWindowOf = (stages: readonly WindowStage[]): ReviewWindow => {
  const here = stages.findIndex((stage) => stage.status === 'current')
  const ahead = stages.slice(here + 1)
  const current = here === -1 ? undefined : stages[here]
  if (current?.reviewing === true) {
    // back to where the run of reviewing stages began
    let first = here
    while (first > 0 && stages[first - 1]!.reviewing) first -= 1
    const closer = ahead.findIndex((stage) => !stage.reviewing)
    if (closer === -1) return { kind: 'stays-open', stage: current.displayName }
    const closing = ahead[closer]!
    const at = instantOf(closing)
    if (at === null) {
      return {
        kind: 'closes-with',
        stage: current.displayName,
        endStage: stages[here + closer]!.displayName,
      }
    }
    const reopening = ahead.slice(closer + 1).find((stage) => stage.reviewing)
    return {
      kind: 'closes',
      stage: current.displayName,
      since: instantOf(stages[first]!),
      at,
      reopens: reopening === undefined ? null : instantOf(reopening),
    }
  }
  const opener = ahead.find((stage) => stage.reviewing)
  if (opener !== undefined) {
    const at = instantOf(opener)
    return at === null ? { kind: 'opens-with', opener: opener.displayName } : { kind: 'opens', at }
  }
  return stages.some((stage) => stage.reviewing) ? { kind: 'ended' } : { kind: 'none' }
}

/** the instant the window next changes, where the timeline knows it */
export const turnOf = (window: ReviewWindow): number | null =>
  window.kind === 'closes' || window.kind === 'opens' ? window.at : null

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * How far off an instant is, in the unit a reader plans by: whole days
 * while there are any, then whole hours, then under an hour. Nothing once
 * it has passed - a window at its turn is about to be read again, and a
 * countdown at zero says nothing true.
 */
export const distanceOf = (
  at: number,
  now: number,
): { readonly unit: 'day' | 'hour'; readonly count: number } | { readonly unit: 'soon' } | null => {
  const left = at - now
  if (left <= 0) return null
  if (left >= DAY) return { unit: 'day', count: Math.floor(left / DAY) }
  if (left >= HOUR) return { unit: 'hour', count: Math.floor(left / HOUR) }
  return { unit: 'soon' }
}
