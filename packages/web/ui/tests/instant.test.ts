import { describe, expect, it } from 'vitest'
import { instantToLocal, localToInstant, offsetMinutesAt, wallClockOf } from '../src/lib/instant.ts'

// The crossing between an instant and a wall clock, asserted without
// assuming which zone this machine keeps: every expectation is either
// built from the same local arithmetic the product uses, or is a
// round trip.

const localOf = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  new Date(year, month - 1, day, hour, minute, second, 0)

const spell = (at: Date) => {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

describe('an instant read as a wall clock', () => {
  it('says nothing when there is nothing to say', () => {
    expect(instantToLocal(null)).toBeNull()
    expect(instantToLocal('')).toBeNull()
    expect(instantToLocal('not a date')).toBeNull()
    expect(localToInstant(null)).toBeNull()
    expect(localToInstant('')).toBeNull()
    expect(localToInstant('9 o clock')).toBeNull()
  })

  it('shows the hour on the reader own wall', () => {
    const at = localOf(2026, 8, 27, 9, 30, 0)
    expect(instantToLocal(at.toISOString())).toBe('2026-08-27 09:30:00')
  })

  it('keeps midnight, and the day it belongs to', () => {
    const at = localOf(2026, 1, 1, 0, 0, 0)
    expect(instantToLocal(at.toISOString())).toBe('2026-01-01 00:00:00')
  })

  it('keeps the seconds', () => {
    const at = localOf(2026, 8, 27, 23, 59, 59)
    expect(instantToLocal(at.toISOString())).toBe('2026-08-27 23:59:59')
  })

  it('reads a wall clock as the moment that reader means', () => {
    expect(localToInstant('2026-08-27 09:30:00')).toBe(localOf(2026, 8, 27, 9, 30, 0).toISOString())
  })

  it('takes a time without seconds as the top of the minute', () => {
    expect(localToInstant('2026-08-27 09:30')).toBe(localOf(2026, 8, 27, 9, 30, 0).toISOString())
  })

  it('comes back to where it started, whatever zone this machine keeps', () => {
    for (const at of [
      localOf(2026, 8, 27, 9, 30, 0),
      localOf(2026, 1, 1, 0, 0, 0),
      localOf(2026, 12, 31, 23, 59, 59),
      localOf(2026, 3, 8, 2, 30, 0),
      localOf(2026, 6, 15, 12, 0, 30),
    ]) {
      const local = instantToLocal(at.toISOString())
      expect(local).toBe(spell(at))
      expect(localToInstant(local)).toBe(at.toISOString())
    }
  })

  it('does not roll a day over on the way across', () => {
    // late enough that a positive offset would push the date forward and an
    // early one would pull it back, if either end used the wrong clock
    for (const at of [localOf(2026, 8, 27, 0, 15, 0), localOf(2026, 8, 27, 23, 45, 0)]) {
      const local = instantToLocal(at.toISOString())
      expect(local?.slice(0, 10)).toBe(spell(at).slice(0, 10))
    }
  })
})

// A named zone's wall, asserted in absolute terms: none of these depend on
// the zone this machine keeps, which is the point of naming one.
describe('a wall clock in a named zone', () => {
  it("reads an instant on that zone's wall, not the device's", () => {
    // 16:00 UTC is midnight the next day in Shanghai and 21:45 in Kathmandu
    expect(instantToLocal('2026-09-04T16:00:00.000Z', 'Asia/Shanghai')).toBe('2026-09-05 00:00:00')
    expect(instantToLocal('2026-09-04T16:00:00.000Z', 'Asia/Kathmandu')).toBe('2026-09-04 21:45:00')
    expect(instantToLocal('2026-09-04T16:00:00.000Z', 'UTC')).toBe('2026-09-04 16:00:00')
  })

  it('writes what was typed as the moment that zone means by it', () => {
    expect(localToInstant('2026-09-05 00:00:00', 'Asia/Shanghai')).toBe('2026-09-04T16:00:00.000Z')
    expect(localToInstant('2026-09-05 00:00', 'Asia/Kathmandu')).toBe('2026-09-04T18:15:00.000Z')
    expect(localToInstant('2026-09-05 00:00:00', 'UTC')).toBe('2026-09-05T00:00:00.000Z')
  })

  it('follows a zone across its daylight-saving change', () => {
    // New York is four hours behind in September and five in December
    expect(localToInstant('2026-09-05 09:00:00', 'America/New_York')).toBe(
      '2026-09-05T13:00:00.000Z',
    )
    expect(localToInstant('2026-12-05 09:00:00', 'America/New_York')).toBe(
      '2026-12-05T14:00:00.000Z',
    )
    // the first morning after the clocks go back, where a guess made from
    // the wall itself still falls in summer time and would be an hour early
    expect(localToInstant('2026-11-01 05:30:00', 'America/New_York')).toBe(
      '2026-11-01T10:30:00.000Z',
    )
  })

  it('comes back to where it started in any zone', () => {
    for (const zone of ['Asia/Shanghai', 'Asia/Kathmandu', 'America/New_York', 'Pacific/Chatham']) {
      for (const iso of [
        '2026-01-01T00:00:00.000Z',
        '2026-03-08T12:30:00.000Z',
        '2026-06-15T23:59:59.000Z',
        '2026-10-31T16:15:00.000Z',
      ]) {
        expect(localToInstant(instantToLocal(iso, zone), zone)).toBe(iso)
      }
    }
  })

  it('says how far ahead of UTC a zone runs at a moment', () => {
    const at = Date.parse('2026-09-05T00:00:00.000Z')
    expect(offsetMinutesAt(at, 'Asia/Shanghai')).toBe(480)
    expect(offsetMinutesAt(at, 'Asia/Kathmandu')).toBe(345)
    expect(offsetMinutesAt(at, 'America/New_York')).toBe(-240)
    expect(offsetMinutesAt(at, 'UTC')).toBe(0)
    expect(wallClockOf(at, 'Asia/Shanghai')).toEqual({
      year: 2026,
      month: 9,
      day: 5,
      hour: 8,
      minute: 0,
      second: 0,
    })
  })

  it('reads midnight as the start of a day, never as its 24th hour', () => {
    expect(wallClockOf(Date.parse('2026-09-04T16:00:00.000Z'), 'Asia/Shanghai').hour).toBe(0)
  })
})
