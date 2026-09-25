// The line between an instant and a wall clock.
//
// The product stores an INSTANT - one moment on the world's timeline, written
// as an iso string - while a person picks a wall-clock time: the hour they
// see on a wall. The two are only the same thing if you know whose wall, so
// every crossing between them happens here, in the open, rather than through
// whatever `new Date(string)` happens to do with a given spelling.
//
// Whose wall is a parameter. Left out, it is the device's own; named, it is
// that IANA zone's, which is how a schedule that belongs to a place is read
// and written the same way from anywhere in the world.
//
// The date-only pickers do not come through here at all. `2026-08-27` is a
// calendar date and has no instant in it; turning it into one and back is how
// a date silently becomes the day before in half the world.

const pad = (part: number) => String(part).padStart(2, '0')

/** a moment as a wall shows it, month counted from 1 */
export interface WallClock {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

// one formatter per zone: building one is the expensive part of the call
const readers = new Map<string, Intl.DateTimeFormat>()

const readerOf = (timeZone: string) => {
  const known = readers.get(timeZone)
  if (known !== undefined) return known
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone,
    // h23, not hour12: false - the latter is allowed to say 24 for midnight
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  readers.set(timeZone, made)
  return made
}

/** what a wall in `timeZone` (the device's own when left out) shows at `at` */
export function wallClockOf(at: number, timeZone?: string): WallClock {
  if (timeZone === undefined) {
    const on = new Date(at)
    return {
      year: on.getFullYear(),
      month: on.getMonth() + 1,
      day: on.getDate(),
      hour: on.getHours(),
      minute: on.getMinutes(),
      second: on.getSeconds(),
    }
  }
  const parts: Record<string, number> = {}
  for (const part of readerOf(timeZone).formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return {
    year: parts['year'] ?? 0,
    month: parts['month'] ?? 1,
    day: parts['day'] ?? 1,
    hour: parts['hour'] ?? 0,
    minute: parts['minute'] ?? 0,
    second: parts['second'] ?? 0,
  }
}

const asUtc = (wall: WallClock) =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)

/** how far ahead of UTC a wall in `timeZone` runs at `at`, in minutes */
export function offsetMinutesAt(at: number, timeZone?: string): number {
  const whole = at - (((at % 1000) + 1000) % 1000)
  return Math.round((asUtc(wallClockOf(whole, timeZone)) - whole) / 60_000)
}

/** the widget's wall-clock spelling: YYYY-MM-DD HH:mm:ss */
export function instantToLocal(instant: string | null, timeZone?: string): string | null {
  if (instant === null || instant === '') return null
  const at = new Date(instant).getTime()
  if (Number.isNaN(at)) return null
  const wall = wallClockOf(at, timeZone)
  const day = `${String(wall.year)}-${pad(wall.month)}-${pad(wall.day)}`
  return `${day} ${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`
}

const MINUTE = 60_000
const DAY = 86_400_000

/** what a wall shows at `at`, as a number, so that two readings compare as moments do */
const readingAt = (at: number, timeZone?: string) => asUtc(wallClockOf(at, timeZone))

/** a typed wall clock as a number, or null when it is not one */
const readingOf = (local: string | null): number | null => {
  if (local === null || local === '') return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim())
  if (parts === null) return null
  const [, year, month, day, hour, minute, second] = parts
  const reading = asUtc({
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: second === undefined ? 0 : Number(second),
  })
  return Number.isNaN(reading) ? null : reading
}

/**
 * The moment a wall reading names, and whether the wall ever shows it.
 *
 * The offsets a day either side of the reading are the offsets before and
 * after any change of clocks near it, so the moments the reading can name
 * are the reading less each of the two. Where the clocks went back it names
 * both, and the earlier is taken: the first time the wall said it. Where
 * they went forward it names neither, because no wall ever showed it, and
 * the answer is the first moment the wall reads that time or later - the
 * moment the clocks changed. Typing 02:30 into the hour New York skips means
 * 03:00, the same way in every zone, and never an hour before what was typed.
 */
const settle = (reading: number, timeZone?: string): { at: number; shown: boolean } => {
  const candidates = [
    ...new Set([
      offsetMinutesAt(reading - DAY, timeZone),
      offsetMinutesAt(reading + DAY, timeZone),
    ]),
  ]
    .map((offset) => reading - offset * MINUTE)
    .sort((a, b) => a - b)
  const shown = candidates.find((at) => readingAt(at, timeZone) === reading)
  if (shown !== undefined) return { at: shown, shown: true }
  let before = candidates[0]!
  let after = candidates[candidates.length - 1]!
  // no offset explains it and no hour was skipped either: an offset in odd
  // seconds, from before zones kept whole minutes
  if (readingAt(before, timeZone) >= reading || readingAt(after, timeZone) < reading) {
    return { at: after, shown: false }
  }
  // the wall reads earlier than the reading at `before` and at least it at
  // `after`; both are whole seconds, and so is every halving between them
  while (after - before > 1000) {
    const middle = before + Math.floor((after - before) / 2000) * 1000
    if (readingAt(middle, timeZone) >= reading) after = middle
    else before = middle
  }
  return { at: after, shown: false }
}

/**
 * The way back: read the parts by hand and build the moment from them.
 *
 * `new Date('2026-08-27 09:30:00')` is not iso, so what it means is left to
 * the engine. The parts are read here instead, and the moment is settled on
 * the wall of the zone named, or on the device's own when none is.
 */
export function localToInstant(local: string | null, timeZone?: string): string | null {
  const reading = readingOf(local)
  if (reading === null) return null
  return new Date(settle(reading, timeZone).at).toISOString()
}

/**
 * Whether the wall of `timeZone` ever shows `local`. It does not inside the
 * hour a daylight-saving change skips, which `localToInstant` moves on to
 * the first time that exists; whoever typed it is owed a word about that,
 * and saying it is the caller's job.
 */
export function wallClockExists(local: string, timeZone?: string): boolean {
  const reading = readingOf(local)
  return reading === null || settle(reading, timeZone).shown
}
