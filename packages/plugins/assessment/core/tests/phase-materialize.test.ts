import { describe, expect, it } from 'vitest'
import { clearDerivedPlansBelow, materializeOffsets } from '../src/phase/engine/materialize.ts'
import { normalizePlan } from '../src/phase/engine/queue.ts'
import { NO_PUBS, phase, pubs, T } from './support/plan.ts'

// §32.34: an offset becomes a plan the moment its anchor's semantic instant
// is determined - a fired boundary, or a publication that promised its
// instant by reaching SCHEDULED. A merely planned upstream boundary
// determines nothing.

const DAY = 24 * 60 * 60 * 1000

describe('materializeOffsets', () => {
  it('materializes on a fired manual boundary, one step deep', () => {
    const fired = T('2026-09-06T12:00:00Z')
    const plan = normalizePlan([
      phase({ ordinal: 0, entryTrigger: 'manual', actualEntryAt: fired }),
      phase({ ordinal: 1, entryOffset: { days: 3 } }),
      phase({ ordinal: 2, entryOffset: { days: 1 } }),
    ])
    // p2 waits: p1's materialized value is still a plan, not a determined
    // instant - chains light up as their boundaries actually fire
    expect(materializeOffsets(plan, NO_PUBS)).toEqual([
      { phaseId: 'p1', plannedEntryAt: fired + 3 * DAY },
    ])
  })

  it('materializes early on a scheduled publication: the promise is the anchor', () => {
    const publishAt = T('2026-09-10T09:00:00Z')
    const plan = normalizePlan([
      phase({ ordinal: 0, entryTrigger: 'publication', opensPublicationId: 'pub-1' }),
      phase({ ordinal: 1, entryOffset: { days: 3 } }),
    ])
    expect(
      materializeOffsets(plan, pubs({ 'pub-1': { status: 'draft', publishAt: null } })),
    ).toEqual([])
    expect(materializeOffsets(plan, pubs({ 'pub-1': { status: 'scheduled', publishAt } }))).toEqual(
      [{ phaseId: 'p1', plannedEntryAt: publishAt + 3 * DAY }],
    )
  })

  it('leaves alone what is planned, entered, or anchored on a mere plan', () => {
    const plan = normalizePlan([
      phase({ ordinal: 0, plannedEntryAt: T('2026-09-05T00:00:00Z') }),
      phase({ ordinal: 1, entryOffset: { days: 3 } }),
      phase({ ordinal: 2, entryOffset: { days: 1 }, plannedEntryAt: T('2026-09-09T00:00:00Z') }),
    ])
    expect(materializeOffsets(plan, NO_PUBS)).toEqual([])
  })

  it('throws on a non-positive offset instead of compressing the phase away', () => {
    const plan = normalizePlan([
      phase({ ordinal: 0, entryTrigger: 'manual', actualEntryAt: T('2026-09-06T12:00:00Z') }),
      phase({ ordinal: 1, entryOffset: { days: 0 } }),
    ])
    expect(() => materializeOffsets(plan, NO_PUBS)).toThrow(/non-positive entry offset/)
  })
})

describe('clearDerivedPlansBelow', () => {
  it('returns derived plans to 待定 and leaves hand-set plans and history alone', () => {
    const plan = normalizePlan([
      phase({ ordinal: 0, actualEntryAt: T('2026-09-01T00:00:00Z') }),
      phase({ ordinal: 1, entryTrigger: 'publication', opensPublicationId: 'pub-1' }),
      // derived: offset spec plus a materialized plan
      phase({ ordinal: 2, entryOffset: { days: 3 }, plannedEntryAt: T('2026-09-13T09:00:00Z') }),
      // hand-set: a plan without an offset spec stays the administrator's own
      phase({ ordinal: 3, plannedEntryAt: T('2026-09-15T00:00:00Z') }),
    ])
    expect(clearDerivedPlansBelow(plan, 1)).toEqual([{ phaseId: 'p2', plannedEntryAt: null }])
  })
})
