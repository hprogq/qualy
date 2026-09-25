import { describe, expect, it } from 'vitest'
import { awake, cst } from '../seed/context.ts'

// Reviewers act in the day: whatever the gap between two steps adds up to,
// a decision falling in the night is taken the next morning after nine.

describe('awake', () => {
  it('leaves a moment in the day where it is', () => {
    expect(awake(cst('2025-03-05T14:20:00'))).toEqual(cst('2025-03-05T14:20:00'))
    expect(awake(cst('2025-03-05T22:59:00'))).toEqual(cst('2025-03-05T22:59:00'))
    expect(awake(cst('2025-03-05T08:00:00'))).toEqual(cst('2025-03-05T08:00:00'))
  })

  it('moves the small hours to that morning and the late evening to the next', () => {
    expect(awake(cst('2025-03-06T02:07:00'))).toEqual(cst('2025-03-06T09:07:00'))
    expect(awake(cst('2025-03-05T23:40:00'))).toEqual(cst('2025-03-06T09:40:00'))
    expect(awake(cst('2025-03-06T07:59:00'))).toEqual(cst('2025-03-06T09:59:00'))
  })

  it('keeps the minutes, not the order, of two moments from one night', () => {
    const earlier = awake(cst('2025-03-06T01:50:00'))
    const later = awake(cst('2025-03-06T02:07:00'))
    expect(earlier).toEqual(cst('2025-03-06T09:50:00'))
    expect(later.getTime()).toBeLessThan(earlier.getTime())
  })
})
