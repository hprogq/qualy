import { describe, expect, it } from 'vitest'
import { dotDay, dotMoment } from '../src/client/batch/dates.ts'
import {
  calendarDaysBetween,
  dayKeyOf,
  deviceDiffers,
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
      offset: 'GMT+8',
    })
    expect(zoneNameOf('Etc/GMT-8', 'en', september)).toEqual({ name: undefined, offset: 'GMT+8' })
  })
})
