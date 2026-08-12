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
      phase({
        ordinal: 2,
        displayName: 'Appeal',
        description: 'after the results are out',
        entryNote: 'once the college has approved the list',
      }),
    ])
    expect(deriveTimeline(plan, NOW)).toEqual([
      {
        phaseId: 'p0',
        phaseKey: 'entry',
        displayName: 'Entry',
        description: '',
        entryNote: '',
        status: 'current',
        entry: { kind: 'entered', at: T('2026-09-01T00:00:00Z') },
      },
      {
        phaseId: 'p1',
        phaseKey: 'entry',
        displayName: 'Review',
        description: '',
        entryNote: '',
        status: 'future',
        entry: { kind: 'planned', at: T('2026-09-20T00:00:00Z') },
      },
      {
        phaseId: 'p2',
        phaseKey: 'entry',
        displayName: 'Appeal',
        description: 'after the results are out',
        // said only while there is no time to say instead
        entryNote: 'once the college has approved the list',
        status: 'future',
        entry: { kind: 'pending' },
      },
    ])
  })

  it('drops what a stage was waiting for once it has a time', () => {
    const plan = normalizePlan([
      phase({ ordinal: 0, actualEntryAt: T('2026-09-01T00:00:00Z') }),
      phase({
        ordinal: 1,
        plannedEntryAt: T('2026-09-20T00:00:00Z'),
        entryNote: 'waiting on the college',
      }),
    ])
    // the date answers the question the note was standing in for
    expect(deriveTimeline(plan, NOW)[1]!.entryNote).toBe('')
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
