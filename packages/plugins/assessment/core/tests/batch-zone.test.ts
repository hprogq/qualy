import { describe, expect, it } from 'vitest'
import { dotDay, dotMoment } from '../src/client/batch/dates.ts'
import {
  calendarDaysBetween,
  dayKeyOf,
  deviceDiffers,
  deviceEverDiffers,
  readableZone,
  zoneNameOf,
} from '../src/client/batch/zone.ts'

// A batch's times are read on the batch's clock. These are asserted in
// absolute terms, so none of them depends on the zone this machine keeps.

const at = (iso: string) => Date.parse(iso)

describe("a batch's clock", () => {
  it('spells a day and a moment on the batch clock', () => {
    // 16:30 UTC on the 4th is 00:30 on the 5th in Shanghai, 22:15 in Kathmandu
    expect(dotDay('2026-09-04T16:30:00.000Z', 'Asia/Shanghai')).toBe('2026.09.05')
    expect(dotMoment('2026-09-04T16:30:00.000Z', 'Asia/Shanghai')).toBe('09.05 00:30')
    expect(dotDay('2026-09-04T16:30:00.000Z', 'Asia/Kathmandu')).toBe('2026.09.04')
    expect(dotMoment('2026-09-04T16:30:00.000Z', 'Asia/Kathmandu')).toBe('09.04 22:15')
    // a stored calendar date is a date, whatever the zone
    expect(dotDay('2026-09-05', 'Asia/Kathmandu')).toBe('2026.09.05')
  })

  it('counts days on the batch calendar, not in spans of hours', () => {
    // twenty minutes apart, either side of midnight in Shanghai
    const before = at('2026-09-04T15:50:00.000Z')
    const after = at('2026-09-04T16:10:00.000Z')
    expect(calendarDaysBetween(before, after, 'Asia/Shanghai')).toBe(1)
    expect(dayKeyOf(before, 'Asia/Shanghai')).toBe('2026-09-04')
    expect(dayKeyOf(after, 'Asia/Shanghai')).toBe('2026-09-05')
    // the same twenty minutes fall inside one Kathmandu evening
    expect(calendarDaysBetween(before, after, 'Asia/Kathmandu')).toBe(0)
  })

  it('falls back to the device clock for a zone this browser cannot read', () => {
    expect(readableZone('Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(readableZone('Not/AZone')).toBeUndefined()
    expect(readableZone('')).toBeUndefined()
    expect(readableZone(null)).toBeUndefined()
  })

  it('never calls a screen without a batch clock out of step with the device', () => {
    expect(deviceDiffers(undefined)).toBe(false)
  })

  it('names a zone the way its reader does, and by its offset alone when it has no name', () => {
    const september = at('2026-09-05T00:00:00.000Z')
    expect(zoneNameOf('Asia/Shanghai', 'en', september)).toEqual({
      name: 'China Standard Time',
      offset: 'UTC+08:00',
    })
    expect(zoneNameOf('Etc/GMT-8', 'en', september)).toEqual({
      name: undefined,
      offset: 'UTC+08:00',
    })
  })
})

// The two clocks are compared at the displayed instant, not at the time of viewing.
describe('whether the device reads a batch time differently', () => {
  const onDevice = <T>(zone: string, read: () => T): T => {
    const kept = process.env['TZ']
    process.env['TZ'] = zone
    try {
      return read()
    } finally {
      if (kept === undefined) delete process.env['TZ']
      else process.env['TZ'] = kept
    }
  }

  it('keeps fractional UTC offsets', () => {
    expect(zoneNameOf('Asia/Kathmandu', 'en', at('2030-09-04T12:00:00.000Z')).offset).toBe(
      'UTC+05:45',
    )
  })

  it('names the offset New York keeps on the day shown, not on the day it is read', () => {
    expect(zoneNameOf('America/New_York', 'en', at('2030-12-20T04:59:00.000Z')).offset).toBe(
      'UTC-05:00',
    )
    expect(zoneNameOf('America/New_York', 'en', at('2030-09-04T12:00:00.000Z')).offset).toBe(
      'UTC-04:00',
    )
  })

  it('marks a moment the two walls read apart though they agree today', () => {
    onDevice('Europe/London', () => {
      // Lagos keeps GMT+1 all year and London only in summer: the same wall
      // in July, an hour apart in December
      expect(deviceDiffers('Africa/Lagos', at('2030-07-20T12:00:00.000Z'))).toBe(false)
      expect(deviceDiffers('Africa/Lagos', at('2030-12-20T12:00:00.000Z'))).toBe(true)
    })
  })

  it('tells a screen its reader is elsewhere where the walls part at any time of year', () => {
    onDevice('Europe/London', () => {
      const summer = at('2030-07-20T12:00:00.000Z')
      // one wall in July, but the screen shows December times too
      expect(deviceDiffers('Africa/Lagos', summer)).toBe(false)
      expect(deviceEverDiffers('Africa/Lagos', summer)).toBe(true)
      // Lisbon keeps London's wall all year round
      expect(deviceEverDiffers('Europe/Lisbon', summer)).toBe(false)
      expect(deviceEverDiffers(undefined, summer)).toBe(false)
    })
  })
})
