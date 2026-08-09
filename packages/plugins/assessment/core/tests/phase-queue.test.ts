import { describe, expect, it } from 'vitest'
import {
  armedPrefix,
  effectiveState,
  materializedIndex,
  normalizePlan,
} from '../src/phase/engine/queue.ts'
import { NO_PUBS, phase, pubs, T } from './support/plan.ts'

// The clock decides what phase a batch is in; materialization only ratifies.
// These are the §24 time-model cases: to-the-second precision, the head-only
// arming, and the publication boundary firing on its publication's promise.

describe('normalizePlan', () => {
  it('sorts by ordinal and refuses corrupt shapes', () => {
    const sorted = normalizePlan([
      phase({ ordinal: 1 }),
      phase({ ordinal: 0, actualEntryAt: T('2026-03-01T00:00:00Z') }),
    ])
    expect(sorted.map((p) => p.ordinal)).toEqual([0, 1])

    expect(() => normalizePlan([phase({ ordinal: 0 }), phase({ ordinal: 0, id: 'dup' })])).toThrow(
      /duplicate ordinal/,
    )
    expect(() =>
      normalizePlan([
        phase({ ordinal: 0 }),
        phase({ ordinal: 1, actualEntryAt: T('2026-03-02T00:00:00Z') }),
      ]),
    ).toThrow(/entered while an earlier phase has not/)
  })
})

describe('effectiveState', () => {
  const entered = phase({
    ordinal: 0,
    plannedEntryAt: T('2026-09-01T00:00:00Z'),
    actualEntryAt: T('2026-09-01T00:00:00Z'),
  })

  it('is exact to the millisecond and records the planned instant, not now', () => {
    const deadline = T('2026-09-05T00:00:00Z')
    const plan = normalizePlan([entered, phase({ ordinal: 1, plannedEntryAt: deadline })])

    expect(effectiveState(plan, NO_PUBS, deadline - 1).index).toBe(0)
    expect(effectiveState(plan, NO_PUBS, deadline).index).toBe(1)

    // the scheduler being 47 seconds late changes nothing: the boundary's
    // semantic instant is its planned value
    const late = effectiveState(plan, NO_PUBS, deadline + 47_000)
    expect(late.index).toBe(1)
    expect(late.pending).toEqual([{ phaseId: 'p1', trigger: 'scheduled', actualEntryAt: deadline }])
  })

  it('advances through consecutive due boundaries in order', () => {
    const plan = normalizePlan([
      entered,
      phase({ ordinal: 1, plannedEntryAt: T('2026-09-05T00:00:00Z') }),
      phase({ ordinal: 2, plannedEntryAt: T('2026-09-08T00:00:00Z') }),
    ])
    const state = effectiveState(plan, NO_PUBS, T('2026-09-09T00:00:00Z'))
    expect(state.index).toBe(2)
    expect(state.pending.map((p) => p.phaseId)).toEqual(['p1', 'p2'])
  })

  it('answers the same whether or not the scheduler has caught up', () => {
    const now = T('2026-09-09T00:00:00Z')
    const lagging = normalizePlan([
      entered,
      phase({ ordinal: 1, plannedEntryAt: T('2026-09-05T00:00:00Z') }),
      phase({ ordinal: 2, plannedEntryAt: T('2026-09-08T00:00:00Z') }),
    ])
    const caughtUp = normalizePlan([
      entered,
      phase({
        ordinal: 1,
        plannedEntryAt: T('2026-09-05T00:00:00Z'),
        actualEntryAt: T('2026-09-05T00:00:00Z'),
      }),
      phase({ ordinal: 2, plannedEntryAt: T('2026-09-08T00:00:00Z') }),
    ])
    expect(effectiveState(lagging, NO_PUBS, now).index).toBe(2)
    expect(effectiveState(caughtUp, NO_PUBS, now).index).toBe(2)
    expect(effectiveState(caughtUp, NO_PUBS, now).pending.map((p) => p.phaseId)).toEqual(['p2'])
  })

  it('never crosses a manual boundary, whatever its planned time says', () => {
    // a planned time on a manual boundary is an SLA; a scheduled boundary
    // beyond it must not self-ignite either
    const plan = normalizePlan([
      entered,
      phase({ ordinal: 1, entryTrigger: 'manual', plannedEntryAt: T('2026-09-05T00:00:00Z') }),
      phase({ ordinal: 2, plannedEntryAt: T('2026-09-06T00:00:00Z') }),
    ])
    const state = effectiveState(plan, NO_PUBS, T('2026-09-09T00:00:00Z'))
    expect(state.index).toBe(0)
    expect(state.pending).toEqual([])
    expect(armedPrefix(plan, NO_PUBS)).toEqual([])
  })

  it('crosses a publication boundary by its publication becoming effective', () => {
    const publishAt = T('2026-09-10T09:00:00Z')
    const plan = normalizePlan([
      entered,
      phase({ ordinal: 1, entryTrigger: 'publication', opensPublicationId: 'pub-1' }),
      phase({ ordinal: 2, plannedEntryAt: T('2026-09-13T17:00:00Z') }),
    ])

    const draft = pubs({ 'pub-1': { status: 'draft', publishAt: null } })
    expect(effectiveState(plan, draft, T('2026-09-11T00:00:00Z')).index).toBe(0)
    expect(armedPrefix(plan, draft)).toEqual([])

    const scheduled = pubs({ 'pub-1': { status: 'scheduled', publishAt } })
    expect(effectiveState(plan, scheduled, publishAt - 1).index).toBe(0)
    // arming crosses the promised boundary into the deadline beyond it
    expect(armedPrefix(plan, scheduled).map((p) => p.id)).toEqual(['p1', 'p2'])

    // at the promise it enters, with publish_at as its semantic instant; the
    // appeal deadline beyond it crosses in the same walk once due
    const due = effectiveState(plan, scheduled, publishAt)
    expect(due.index).toBe(1)
    expect(due.pending).toEqual([
      { phaseId: 'p1', trigger: 'publication', actualEntryAt: publishAt },
    ])
    const past = effectiveState(plan, scheduled, T('2026-09-13T17:00:00Z'))
    expect(past.index).toBe(2)
    expect(past.pending.map((p) => p.actualEntryAt)).toEqual([publishAt, T('2026-09-13T17:00:00Z')])

    const cancelled = pubs({ 'pub-1': { status: 'cancelled', publishAt } })
    expect(effectiveState(plan, cancelled, T('2026-09-13T17:00:00Z')).index).toBe(0)
    expect(armedPrefix(plan, cancelled)).toEqual([])
  })

  it('throws when a bound publication was not provided', () => {
    const plan = normalizePlan([
      phase({ ordinal: 0, entryTrigger: 'publication', opensPublicationId: 'pub-9' }),
    ])
    expect(() => effectiveState(plan, NO_PUBS, T('2026-09-01T00:00:00Z'))).toThrow(
      /did not provide/,
    )
  })

  it('rescans idempotently: applying the pending transitions empties them', () => {
    const now = T('2026-09-09T00:00:00Z')
    const plan = normalizePlan([
      entered,
      phase({ ordinal: 1, plannedEntryAt: T('2026-09-05T00:00:00Z') }),
    ])
    const first = effectiveState(plan, NO_PUBS, now)
    expect(first.pending).toHaveLength(1)

    const applied = normalizePlan(
      plan.map((p) =>
        p.id === 'p1' ? { ...p, actualEntryAt: first.pending[0]!.actualEntryAt } : p,
      ),
    )
    expect(materializedIndex(applied)).toBe(1)
    expect(effectiveState(applied, NO_PUBS, now).pending).toEqual([])
  })
})

describe('armedPrefix', () => {
  it('crosses armed boundaries and stops at the first that needs an event or a plan', () => {
    const publishAt = T('2026-09-10T09:00:00Z')
    const scheduledPub = pubs({ 'pub-1': { status: 'scheduled', publishAt } })
    const plan = normalizePlan([
      phase({ ordinal: 0, actualEntryAt: T('2026-09-01T00:00:00Z') }),
      phase({ ordinal: 1, plannedEntryAt: T('2026-09-05T00:00:00Z') }),
      phase({ ordinal: 2, entryTrigger: 'publication', opensPublicationId: 'pub-1' }),
      phase({ ordinal: 3, plannedEntryAt: T('2026-09-13T17:00:00Z') }),
      phase({ ordinal: 4, entryTrigger: 'manual' }),
      phase({ ordinal: 5, plannedEntryAt: T('2026-09-20T00:00:00Z') }),
    ])
    expect(armedPrefix(plan, scheduledPub).map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])

    // an unmaterialized offset target is not armed: nothing to fire on
    const unmaterialized = normalizePlan(
      plan.map((p) => (p.id === 'p3' ? { ...p, plannedEntryAt: null } : p)),
    )
    expect(armedPrefix(unmaterialized, scheduledPub).map((p) => p.id)).toEqual(['p1', 'p2'])

    // an unbound publication boundary stops the prefix cold
    const unbound = normalizePlan(
      plan.map((p) => (p.id === 'p2' ? { ...p, opensPublicationId: null } : p)),
    )
    expect(armedPrefix(unbound, NO_PUBS).map((p) => p.id)).toEqual(['p1'])
  })
})
