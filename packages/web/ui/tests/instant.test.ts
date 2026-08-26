import { describe, expect, it } from 'vitest'
import { instantToLocal, localToInstant } from '../src/lib/instant.ts'

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
