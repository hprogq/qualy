import { describe, expect, it } from 'vitest'
import { randomStream } from '../seed/random-stream.ts'
import { drawSecondaryActivities, SECONDARY_ACTIVITIES } from '../seed/secondary-activities.ts'

describe('secondary college activity sampling', () => {
  it('keeps one to four distinct events per student with their original evidence pairs', () => {
    const counts = new Set<number>()
    const events = new Set<string>()
    for (let student = 0; student < 1000; student++) {
      const random = randomStream('secondary-distinct-events', student)
      const count = random.int(1, 4)
      const claims = drawSecondaryActivities(random, count)
      counts.add(claims.length)
      expect(claims).toHaveLength(count)
      expect(new Set(claims.map(({ activity }) => activity.key)).size).toBe(count)
      for (const { spec, activity } of claims) {
        expect(SECONDARY_ACTIVITIES).toContain(spec)
        expect(spec.activities).toContain(activity)
        expect(activity.proof).toBe(`english-${activity.key}-proof`)
        expect(activity.ask.instructions).toContain(activity.name)
        events.add(activity.key)
      }
      const repeated = randomStream('secondary-distinct-events', student)
      expect(drawSecondaryActivities(repeated, repeated.int(1, 4))).toEqual(claims)
    }
    expect(counts).toEqual(new Set([1, 2, 3, 4]))
    expect(events.size).toBe(12)
  })

  it('cannot repeat an event even when every draw chooses the same position', () => {
    const random = { int: (min: number) => min }
    const all = drawSecondaryActivities(random, 12)
    expect(new Set(all.map(({ activity }) => activity.key)).size).toBe(12)
    expect(drawSecondaryActivities(random, 4)).toEqual(all.slice(0, 4))
    expect(() => drawSecondaryActivities(random, 13)).toThrow(RangeError)
  })
})
