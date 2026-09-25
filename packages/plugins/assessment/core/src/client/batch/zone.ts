import { createContext, useContext } from 'react'
import { offsetMinutesAt, wallClockOf } from '@qualy/ui/instant'

// Whose clock a batch's times are read on.
//
// A round belongs to a place: its deadlines are the school's deadlines, and
// "filing closes at midnight" means midnight there. So every moment a batch
// screen shows or takes - a stage's start, a deadline, when something
// happened, which day a row falls on - is read on the batch's own zone, not
// on whatever zone the reader's device keeps. The instant stored is the
// same either way; only the wall it is read on is chosen here.
//
// The zone rides down the tree from whoever loaded the batch. A screen
// outside any batch leaves it unset and reads on the device's clock, as
// before.

/**
 * The zone as the batch stored it, or nothing when this browser cannot read
 * it. Stored zones are checked when written, but a zone written before that
 * check, or one this browser's tz data does not know, must not take the
 * page down: the device's clock is the fallback.
 */
export const readableZone = (zone: string | null | undefined): string | undefined => {
  if (zone === null || zone === undefined || zone === '') return undefined
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone })
    return zone
  } catch {
    return undefined
  }
}

export const BatchZoneContext = createContext<string | undefined>(undefined)

/** the zone of the batch this screen belongs to; unset outside one */
export const useBatchZone = (): string | undefined => useContext(BatchZoneContext)

const pad = (part: number) => String(part).padStart(2, '0')

/** the calendar day a moment falls on in the zone, as YYYY-MM-DD */
export const dayKeyOf = (at: number, zone: string | undefined): string => {
  const wall = wallClockOf(at, zone)
  return `${String(wall.year)}-${pad(wall.month)}-${pad(wall.day)}`
}

/** the year a moment falls in, in the zone */
export const yearOf = (at: number, zone: string | undefined): number => wallClockOf(at, zone).year

/**
 * Whole calendar days from `from` to `to`, counted on the zone's calendar:
 * 23:50 and 00:10 the next morning are a day apart, though twenty minutes
 * separate them.
 */
export const calendarDaysBetween = (from: number, to: number, zone: string | undefined): number => {
  const dayOf = (at: number) => {
    const wall = wallClockOf(at, zone)
    return Date.UTC(wall.year, wall.month - 1, wall.day)
  }
  return Math.round((dayOf(to) - dayOf(from)) / 86_400_000)
}

/**
 * Whether the device reads the clock differently from the batch right now.
 * Compared by offset rather than by name: two names for the same wall are
 * the same wall to the reader.
 */
export const deviceDiffers = (zone: string | undefined, now: number = Date.now()): boolean =>
  zone !== undefined && offsetMinutesAt(now, zone) !== offsetMinutesAt(now)

/** Intl's options for a batch time: the zone when there is one, nothing otherwise */
export const inZone = (zone: string | undefined): { timeZone?: string } =>
  zone === undefined ? {} : { timeZone: zone }

const zonePart = (
  locale: string,
  zone: string,
  at: number,
  style: Intl.DateTimeFormatOptions['timeZoneName'],
) =>
  new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: style })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value

/**
 * A zone as a reader recognizes it: its name in their language and its
 * offset, "China Standard Time" and "GMT+8". A zone the language has no name
 * for has only its offset - "GMT+08:00" beside "GMT+8" says the same thing
 * twice.
 */
export const zoneNameOf = (
  zone: string,
  locale: string,
  at: number = Date.now(),
): { readonly name: string | undefined; readonly offset: string } => ({
  name: [zonePart(locale, zone, at, 'longGeneric'), zonePart(locale, zone, at, 'long')].find(
    (candidate) =>
      candidate !== undefined && !candidate.startsWith('GMT') && !candidate.startsWith('UTC'),
  ),
  offset: zonePart(locale, zone, at, 'shortOffset') ?? zone,
})
