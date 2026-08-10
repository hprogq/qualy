import { describe, expect, it } from 'vitest'
import {
  armedPrefix,
  effectiveState,
  materializedIndex,
  normalizePlan,
  scheduledIndex,
} from '../src/phase/engine/queue.ts'
import { phase, T } from './support/plan.ts'

// The clock decides what phase a batch is in, and a plan's three regions are
// read off one shape: entered, then scheduled, then neither.

const NOW = T('2026-09-05T12:00:00Z')

describe('normalizing a plan', () => {
  it('sorts by ordinal', () => {
    const plan = normalizePlan([phase({ ordinal: 1 }), phase({ ordinal: 0 })])
    expect(plan.map((p) => p.ordinal)).toEqual([0, 1])
  })

  it('refuses shapes a correct write cannot produce', () => {
    expect(() =>
      normalizePlan([phase({ ordinal: 0 }), phase({ ordinal: 0, id: 'other' })]),
    ).toThrow(/duplicate ordinal/)
    expect(() =>
      normalizePlan([phase({ ordinal: 0 }), phase({ ordinal: 1, actualEntryAt: NOW })]),
    ).toThrow(/entered while an earlier phase has not/)
    // times form a prefix: a scheduled phase after an unscheduled one is the
    // shape the whole model exists to make impossible
    expect(() =>
      normalizePlan([phase({ ordinal: 0 }), phase({ ordinal: 1, plannedEntryAt: NOW })]),
    ).toThrow(/scheduled while an earlier phase is not/)
  })
})

describe('where a plan stands', () => {
  const plan = normalizePlan([
    phase({ ordinal: 0, actualEntryAt: T('2026-09-01T00:00:00Z') }),
    phase({ ordinal: 1, plannedEntryAt: T('2026-09-04T00:00:00Z') }),
    phase({ ordinal: 2, plannedEntryAt: T('2026-09-20T00:00:00Z') }),
    phase({ ordinal: 3 }),
  ])

  it('separates what happened, what is due, and what has no time', () => {
    expect(materializedIndex(plan)).toBe(0)
    expect(scheduledIndex(plan)).toBe(2)
    expect(armedPrefix(plan).map((p) => p.ordinal)).toEqual([1, 2])
  })

  it('crosses a boundary the moment its planned instant has passed', () => {
    const state = effectiveState(plan, NOW)
    // phase 1 was due on the 4th; phase 2 is not due until the 20th
    expect(state.index).toBe(1)
    expect(state.pending).toEqual([
      { phaseId: plan[1]!.id, actualEntryAt: T('2026-09-04T00:00:00Z') },
    ])
  })

  it('records the semantic instant, not the moment the scheduler woke up', () => {
    const late = effectiveState(plan, T('2026-09-04T00:07:00Z'))
    expect(late.pending[0]?.actualEntryAt).toBe(T('2026-09-04T00:00:00Z'))
  })

  it('has nothing pending once materialization caught up', () => {
    const caught = normalizePlan([
      phase({ ordinal: 0, actualEntryAt: T('2026-09-01T00:00:00Z') }),
      phase({ ordinal: 1, actualEntryAt: T('2026-09-04T00:00:00Z') }),
    ])
    expect(effectiveState(caught, NOW).pending).toEqual([])
  })

  it('goes nowhere while nothing has a time', () => {
    const idle = normalizePlan([phase({ ordinal: 0 }), phase({ ordinal: 1 })])
    const state = effectiveState(idle, NOW)
    expect(state.index).toBe(-1)
    expect(state.phase).toBeNull()
    expect(armedPrefix(idle)).toEqual([])
  })
})
