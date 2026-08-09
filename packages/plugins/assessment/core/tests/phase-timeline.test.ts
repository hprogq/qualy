import { describe, expect, it } from 'vitest'
import { normalizePlan } from '../src/phase/engine/queue.ts'
import { deriveTimeline } from '../src/phase/engine/timeline.ts'
import { phase, pubs, T } from './support/plan.ts'

// The §10 display priority, fixed once: entered > planned (definite) >
// announced (a publication's promise) > estimated (roughly) > pending. A
// manual boundary's planned time is an internal SLA and never surfaces.

describe('deriveTimeline', () => {
  it('derives the default sequence mid-flight, honestly at every slot', () => {
    const publishAt = T('2026-09-10T09:00:00Z')
    const now = T('2026-09-06T00:00:00Z')
    const plan = normalizePlan([
      phase({
        ordinal: 0,
        phaseKey: 'entry',
        plannedEntryAt: T('2026-09-01T00:00:00Z'),
        actualEntryAt: T('2026-09-01T00:00:00Z'),
      }),
      phase({
        ordinal: 1,
        phaseKey: 'review',
        plannedEntryAt: T('2026-09-05T00:00:00Z'),
        actualEntryAt: T('2026-09-05T00:00:00Z'),
      }),
      // an SLA on the close-out is ops-facing; students see 待定
      phase({
        ordinal: 2,
        phaseKey: 'publication-prep',
        entryTrigger: 'manual',
        plannedEntryAt: T('2026-09-08T00:00:00Z'),
      }),
      phase({
        ordinal: 3,
        phaseKey: 'appeal',
        entryTrigger: 'publication',
        opensPublicationId: 'pub-1',
      }),
      phase({
        ordinal: 4,
        phaseKey: 'appeal-processing',
        entryOffset: { days: 3 },
        plannedEntryAt: publishAt + 3 * 24 * 60 * 60 * 1000,
      }),
      phase({
        ordinal: 5,
        phaseKey: 'confirmation',
        entryTrigger: 'publication',
        estimatedEntryAt: T('2026-09-16T00:00:00Z'),
      }),
      phase({ ordinal: 6, phaseKey: 'archive', entryTrigger: 'manual' }),
    ])
    const lookup = pubs({ 'pub-1': { status: 'scheduled', publishAt } })

    expect(deriveTimeline(plan, lookup, now)).toEqual([
      {
        phaseId: 'p0',
        phaseKey: 'entry',
        displayName: 'Phase 0',
        status: 'ended',
        entry: { kind: 'entered', at: T('2026-09-01T00:00:00Z') },
      },
      {
        phaseId: 'p1',
        phaseKey: 'review',
        displayName: 'Phase 1',
        status: 'current',
        entry: { kind: 'entered', at: T('2026-09-05T00:00:00Z') },
      },
      {
        phaseId: 'p2',
        phaseKey: 'publication-prep',
        displayName: 'Phase 2',
        status: 'future',
        entry: { kind: 'pending' },
      },
      {
        phaseId: 'p3',
        phaseKey: 'appeal',
        displayName: 'Phase 3',
        status: 'future',
        // the single source: the publication's own promise, never a copy
        entry: { kind: 'announced', at: publishAt },
      },
      {
        phaseId: 'p4',
        phaseKey: 'appeal-processing',
        displayName: 'Phase 4',
        status: 'future',
        entry: { kind: 'planned', at: publishAt + 3 * 24 * 60 * 60 * 1000 },
      },
      {
        phaseId: 'p5',
        phaseKey: 'confirmation',
        displayName: 'Phase 5',
        status: 'future',
        entry: { kind: 'estimated', at: T('2026-09-16T00:00:00Z') },
      },
      {
        phaseId: 'p6',
        phaseKey: 'archive',
        displayName: 'Phase 6',
        status: 'future',
        entry: { kind: 'pending' },
      },
    ])
  })

  it('shows a clock-crossed boundary as entered before the scheduler catches up', () => {
    const deadline = T('2026-09-05T00:00:00Z')
    const plan = normalizePlan([
      phase({ ordinal: 0, actualEntryAt: T('2026-09-01T00:00:00Z') }),
      phase({ ordinal: 1, plannedEntryAt: deadline }),
    ])
    const [first, second] = deriveTimeline(plan, new Map(), deadline + 60_000)
    expect(first).toMatchObject({ status: 'ended' })
    expect(second).toMatchObject({ status: 'current', entry: { kind: 'entered', at: deadline } })
  })
})
