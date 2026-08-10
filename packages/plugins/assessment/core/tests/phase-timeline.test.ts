import { describe, expect, it } from 'vitest'
import { normalizePlan } from '../src/phase/engine/queue.ts'
import { deriveTimeline } from '../src/phase/engine/timeline.ts'
import { phase, T } from './support/plan.ts'

// What a participant sees: what happened, what is due to happen, and - for
// everything past the last committed time - that it is simply not scheduled.

const NOW = T('2026-09-05T12:00:00Z')

describe('the participant timeline', () => {
  it('says what happened, what is due, and what has no time yet', () => {
    const plan = normalizePlan([
      phase({ ordinal: 0, displayName: 'Entry', actualEntryAt: T('2026-09-01T00:00:00Z') }),
      phase({ ordinal: 1, displayName: 'Review', plannedEntryAt: T('2026-09-20T00:00:00Z') }),
      phase({ ordinal: 2, displayName: 'Appeal', description: 'after the results are out' }),
    ])
    expect(deriveTimeline(plan, NOW)).toEqual([
      {
        phaseId: 'p0',
        phaseKey: 'entry',
        displayName: 'Entry',
        description: '',
        status: 'current',
        entry: { kind: 'entered', at: T('2026-09-01T00:00:00Z') },
      },
      {
        phaseId: 'p1',
        phaseKey: 'entry',
        displayName: 'Review',
        description: '',
        status: 'future',
        entry: { kind: 'planned', at: T('2026-09-20T00:00:00Z') },
      },
      {
        phaseId: 'p2',
        phaseKey: 'entry',
        displayName: 'Appeal',
        description: 'after the results are out',
        status: 'future',
        entry: { kind: 'pending' },
      },
    ])
  })

  it('counts a boundary the clock crossed as entered before anyone ratifies it', () => {
    const plan = normalizePlan([
      phase({ ordinal: 0, actualEntryAt: T('2026-09-01T00:00:00Z') }),
      phase({ ordinal: 1, plannedEntryAt: T('2026-09-04T00:00:00Z') }),
    ])
    const timeline = deriveTimeline(plan, NOW)
    expect(timeline[1]!.entry).toEqual({ kind: 'entered', at: T('2026-09-04T00:00:00Z') })
    expect(timeline.map((row) => row.status)).toEqual(['ended', 'current'])
  })
})
