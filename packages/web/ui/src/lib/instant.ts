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

/**
 * The way back: read the parts by hand and build the moment from them.
 *
 * `new Date('2026-08-27 09:30:00')` is not iso, so what it means is left to
 * the engine. On the device's wall the numeric constructor is defined to
 * read its arguments as local time, which is exactly what the person typed.
 * On a named zone's wall the offset is looked up for the moment itself and
 * checked once more from the other side, because a daylight-saving change
 * between the guess and the answer moves it.
 */
export function localToInstant(local: string | null, timeZone?: string): string | null {
  if (local === null || local === '') return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim())
  if (parts === null) return null
  const [, year, month, day, hour, minute, second] = parts
  const wall: WallClock = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: second === undefined ? 0 : Number(second),
  }
  if (timeZone === undefined) {
    const at = new Date(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, 0)
    if (Number.isNaN(at.getTime())) return null
    return at.toISOString()
  }
  const guess = asUtc(wall)
  if (Number.isNaN(guess)) return null
  const first = guess - offsetMinutesAt(guess, timeZone) * 60_000
  const settled = guess - offsetMinutesAt(first, timeZone) * 60_000
  return new Date(settled).toISOString()
}
