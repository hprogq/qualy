import type { assessmentMessages } from '../i18n.ts'

// How long until the next stage, or how long this one has been running.
//
// Two questions with one answer shape, because they are the same question
// asked from either side of a boundary that may not exist yet: a stage with a
// scheduled successor is counting down to it, and a stage without one has
// simply been running since it began.
//
// Both are said in two units, never more: "1 day 3 hours" is what somebody
// plans around, and the minutes under it are noise they have to read past.
// The second unit is dropped when it is zero, so "3 hours" stays "3 hours"
// rather than becoming "3 hours 0 minutes".

export interface TimelineLike {
  readonly displayName: string
  readonly status: 'ended' | 'current' | 'future'
  readonly entry: { readonly kind: 'entered' | 'planned' | 'pending'; readonly at: string | null }
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export interface Elapsed {
  /** the larger unit, which decides how the whole thing is said */
  readonly unit: 'days' | 'hours' | 'minutes' | 'seconds'
  readonly value: number
  /** the one below it, zero when there is nothing left to say */
  readonly rest: number
}

/** a span as its two largest units, the smaller dropped when it is empty */
export const spanOf = (ms: number): Elapsed => {
  const total = Math.max(0, ms)
  if (total >= DAY) {
    return {
      unit: 'days',
      value: Math.floor(total / DAY),
      rest: Math.floor((total % DAY) / HOUR),
    }
  }
  if (total >= HOUR) {
    return {
      unit: 'hours',
      value: Math.floor(total / HOUR),
      rest: Math.floor((total % HOUR) / MINUTE),
    }
  }
  if (total >= MINUTE) {
    return {
      unit: 'minutes',
      value: Math.floor(total / MINUTE),
      rest: Math.floor((total % MINUTE) / SECOND),
    }
  }
  return { unit: 'seconds', value: Math.floor(total / SECOND), rest: 0 }
}

export type Progress =
  /** counting down to the stage that follows this one */
  | { readonly kind: 'until'; readonly span: Elapsed }
  /** nothing is scheduled after it, so all there is to say is how long */
  | { readonly kind: 'since'; readonly span: Elapsed }
  /** the batch has not begun; when it is due to */
  | { readonly kind: 'starts'; readonly at: number }
  | { readonly kind: 'none' }

/**
 * What the bar can say about a plan right now.
 *
 * A stage ends when the next one begins, which is why the countdown reads the
 * successor's planned time rather than anything on the stage itself - there
 * is no end stored anywhere, and inventing one here would be inventing a
 * second truth.
 */
export function progressOf(timeline: readonly TimelineLike[], now: number): Progress {
  const index = timeline.findIndex((entry) => entry.status === 'current')
  if (index === -1) {
    const first = timeline.find(
      (entry) => entry.entry.kind === 'planned' && entry.entry.at !== null,
    )
    return first ? { kind: 'starts', at: Date.parse(first.entry.at!) } : { kind: 'none' }
  }
  const next = timeline[index + 1]
  if (next?.entry.kind === 'planned' && next.entry.at !== null) {
    return { kind: 'until', span: spanOf(Date.parse(next.entry.at) - now) }
  }
  const current = timeline[index]!
  if (current.entry.at === null) return { kind: 'none' }
  return { kind: 'since', span: spanOf(now - Date.parse(current.entry.at)) }
}

/** how often the shown value could still change, so nothing ticks needlessly */
export const tickOf = (progress: Progress): number =>
  progress.kind === 'until' || progress.kind === 'since'
    ? // hours under a day, minutes under an hour: neither moves faster than
      // once a minute, and a clock that ticks for nothing is a clock that
      // re-renders a page for nothing
      progress.span.unit === 'days' || progress.span.unit === 'hours'
      ? MINUTE
      : SECOND
    : MINUTE

type Messages = typeof assessmentMessages

/** the message and values for a span, in the caller's locale */
export const spanMessage = (
  m: Messages,
  progress: Progress & { kind: 'until' | 'since' },
): { message: Messages[keyof Messages]; values: Record<string, number> } => {
  const { span } = progress
  const counting = progress.kind === 'until'
  const both = span.rest > 0
  if (span.unit === 'days') {
    return both
      ? {
          message: counting ? m.leftDaysHours : m.sinceDaysHours,
          values: { days: span.value, hours: span.rest },
        }
      : { message: counting ? m.leftDays : m.sinceDays, values: { count: span.value } }
  }
  if (span.unit === 'hours') {
    return both
      ? {
          message: counting ? m.leftHoursMinutes : m.sinceHoursMinutes,
          values: { hours: span.value, minutes: span.rest },
        }
      : { message: counting ? m.leftHours : m.sinceHours, values: { count: span.value } }
  }
  if (span.unit === 'minutes') {
    return both
      ? {
          message: counting ? m.leftMinutes : m.sinceMinutes,
          values: { minutes: span.value, seconds: span.rest },
        }
      : {
          message: counting ? m.leftMinutesOnly : m.sinceMinutesOnly,
          values: { count: span.value },
        }
  }
  return { message: counting ? m.leftSeconds : m.sinceSeconds, values: { count: span.value } }
}
