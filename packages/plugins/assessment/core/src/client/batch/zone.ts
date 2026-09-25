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
 * Whether the device reads the moment `at` differently from the batch, now
 * when no moment is named. Compared by offset rather than by name: two names
 * for the same wall are the same wall to the reader. Asked of a moment
 * because two zones can keep one wall in summer and two in winter.
 */
export const deviceDiffers = (zone: string | undefined, at: number = Date.now()): boolean =>
  zone !== undefined && offsetMinutesAt(at, zone) !== offsetMinutesAt(at)

const WEEK = 7 * 86_400_000

/**
 * Whether the device reads any moment within half a year either side of
 * `around` differently from the batch. For a notice about a whole screen,
 * whose times fall in both halves of the year: a London device and a Lagos
 * batch keep one wall all summer and are an hour apart all winter. Asked a
 * week apart, since clocks change on a scale of seasons, not of days.
 */
export const deviceEverDiffers = (
  zone: string | undefined,
  around: number = Date.now(),
): boolean => {
  if (zone === undefined) return false
  for (let week = -26; week <= 26; week += 1) {
    if (deviceDiffers(zone, around + week * WEEK)) return true
  }
  return false
}

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

/**
 * The batch's offset at `at`, "GMT+5:45", to write after that moment read on
 * its clock - or null for a reader whose device reads the moment the same
 * way, to whom the bare time is already their own. Both are asked of the
 * moment shown, not of today: a New York deadline in December is at GMT-5
 * however early in autumn it is read, and a Lagos one is an hour off a
 * London device then though the two walls agree all summer.
 *
 * Where a whole plan is on screen, `ZoneNote` says the zone once instead;
 * this is for a time that stands alone, on a card or in a row of a list.
 */
export const zoneMarkOf = (
  zone: string | null | undefined,
  locale: string,
  at: number | string,
): string | null => {
  const clock = readableZone(zone)
  if (clock === undefined) return null
  const moment = new Date(at).getTime()
  if (Number.isNaN(moment) || !deviceDiffers(clock, moment)) return null
  return zonePart(locale, clock, moment, 'shortOffset') ?? clock
}

/** `zoneMarkOf` for the batch this screen belongs to, said in `locale`, for any moment on it */
export const useZoneMark = (locale: string): ((at: number | string) => string | null) => {
  const zone = useBatchZone()
  return (at) => zoneMarkOf(zone, locale, at)
}

/** a time with the batch's offset after it, when the reader needs one */
export const marked = (time: string, mark: string | null): string =>
  mark === null ? time : `${time} ${mark}`
