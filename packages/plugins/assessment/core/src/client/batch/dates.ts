import { wallClockOf } from '@qualy/ui/instant'

// The one notation for a date on the batch screens: a day is `2026.03.01`,
// a moment is `03.01 23:59`. Numeric, so it reads the same in every locale,
// and the same on a card, in a table and on an axis - three notations on
// one screen made the reader translate between them.

const two = (n: number) => String(n).padStart(2, '0')

/**
 * A calendar day. A date-only string (`YYYY-MM-DD`, the shape a material
 * window is stored in) is re-spelled rather than parsed: parsed it would be
 * midnight UTC, which is the previous day west of Greenwich. An instant is
 * read on the batch's clock (`zone`), or the reader's own without one.
 */
export const dotDay = (at: string | number, zone?: string): string => {
  if (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at.replaceAll('-', '.')
  const wall = wallClockOf(new Date(at).getTime(), zone)
  return `${String(wall.year)}.${two(wall.month)}.${two(wall.day)}`
}

/** a moment within the year, to the minute, on the batch's clock or the reader's own */
export const dotMoment = (at: string | number, zone?: string): string => {
  const wall = wallClockOf(new Date(at).getTime(), zone)
  return `${two(wall.month)}.${two(wall.day)} ${two(wall.hour)}:${two(wall.minute)}`
}
