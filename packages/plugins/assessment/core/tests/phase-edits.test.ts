import { describe, expect, it } from 'vitest'
import {
  planInsertion,
  reviewInsertion,
  reviewPlan,
  reviewPlanEdit,
  reviewPlanShape,
  type PlanEdit,
} from '../src/phase/engine/edits.ts'
import { normalizePlan } from '../src/phase/engine/queue.ts'
import type { PublicationLookup } from '../src/phase/engine/types.ts'
import { NO_PUBS, phase, pubs, T } from './support/plan.ts'

// The seven edit validators, exercised over the default sequence mid-flight:
// the batch is in its review phase, the manual close-out has not fired, the
// appeal boundary is unbound. Time is history the moment the clock says so.

const T0 = T('2026-08-20T00:00:00Z')
const T1 = T('2026-09-01T00:00:00Z')
const T2 = T('2026-09-05T00:00:00Z')
const NOW = T('2026-09-06T00:00:00Z')

const midFlight = () =>
  normalizePlan([
    phase({ ordinal: 0, phaseKey: 'pre-entry', plannedEntryAt: T0, actualEntryAt: T0 }),
    phase({ ordinal: 1, phaseKey: 'entry', plannedEntryAt: T1, actualEntryAt: T1 }),
    phase({ ordinal: 2, phaseKey: 'review', plannedEntryAt: T2, actualEntryAt: T2 }),
    phase({ ordinal: 3, phaseKey: 'publication-prep', entryTrigger: 'manual' }),
    phase({ ordinal: 4, phaseKey: 'appeal', entryTrigger: 'publication' }),
    phase({ ordinal: 5, phaseKey: 'appeal-processing', entryOffset: { days: 3 } }),
    phase({ ordinal: 6, phaseKey: 'confirmation', entryTrigger: 'publication' }),
    phase({ ordinal: 7, phaseKey: 'archive', entryTrigger: 'manual' }),
  ])

const reasonsOf = (plan = midFlight(), edit: PlanEdit, publications: PublicationLookup = NO_PUBS) =>
  reviewPlanEdit(plan, publications, NOW, edit).refusals.map((r) => r.reason)

describe('actual is immutable', () => {
  it('refuses setting actual on any phase, entered or not', () => {
    expect(reasonsOf(undefined, { kind: 'set-actual', phaseId: 'p3', actualEntryAt: NOW })).toEqual(
      ['actual-immutable'],
    )
    expect(reasonsOf(undefined, { kind: 'set-actual', phaseId: 'p1', actualEntryAt: NOW })).toEqual(
      ['actual-immutable'],
    )
  })
})

describe('entered phases', () => {
  it('lock their time fields, keep their name editable', () => {
    const planned = T('2026-09-20T00:00:00Z')
    expect(
      reasonsOf(undefined, { kind: 'set-planned', phaseId: 'p2', plannedEntryAt: planned }),
    ).toEqual(['phase-already-entered'])
    expect(
      reasonsOf(undefined, { kind: 'set-estimated', phaseId: 'p1', estimatedEntryAt: planned }),
    ).toEqual(['phase-already-entered'])
    expect(
      reviewPlanEdit(midFlight(), NO_PUBS, NOW, {
        kind: 'rename',
        phaseId: 'p1',
        displayName: 'Renamed',
      }).refusals,
    ).toEqual([])
  })

  it('treats a clock-crossed, unmaterialized boundary as entered', () => {
    // the scheduler has not ratified p2 yet; its entry is history regardless
    const lagging = normalizePlan(
      midFlight().map((p) => (p.id === 'p2' ? { ...p, actualEntryAt: null } : p)),
    )
    expect(
      reasonsOf(lagging, { kind: 'set-planned', phaseId: 'p2', plannedEntryAt: NOW + 1 }),
    ).toEqual(['phase-already-entered'])
  })

  it('allows only the name on ended phases', () => {
    expect(
      reasonsOf(undefined, {
        kind: 'set-profile',
        phaseId: 'p1',
        permissionProfile: ['assessment.entry.submit'],
      }),
    ).toEqual(['ended-phase-name-only'])
    // the current phase's profile stays adjustable; the schedule freeze that
    // may forbid it is the service layer's rule, not the engine's
    expect(
      reasonsOf(undefined, {
        kind: 'set-profile',
        phaseId: 'p2',
        permissionProfile: ['assessment.review.process'],
      }),
    ).toEqual([])
  })
})

describe('hard plans', () => {
  it('may not sit beyond an unfired manual or unarmed publication boundary', () => {
    const review = reviewPlanEdit(midFlight(), NO_PUBS, NOW, {
      kind: 'set-planned',
      phaseId: 'p5',
      plannedEntryAt: T('2026-09-13T17:00:00Z'),
    })
    expect(review.refusals).toEqual([
      { reason: 'hard-plan-beyond-event-boundary', phaseId: 'p5', blockingPhaseId: 'p3' },
    ])

    // the manual boundary fired, but the appeal boundary is still unbound:
    // it withholds the date for the same reason
    const prepDone = normalizePlan(
      midFlight().map((p) =>
        p.id === 'p3' ? { ...p, actualEntryAt: T('2026-09-06T12:00:00Z') } : p,
      ),
    )
    expect(
      reviewPlanEdit(prepDone, NO_PUBS, T('2026-09-07T00:00:00Z'), {
        kind: 'set-planned',
        phaseId: 'p5',
        plannedEntryAt: T('2026-09-13T17:00:00Z'),
      }).refusals,
    ).toEqual([{ reason: 'hard-plan-beyond-event-boundary', phaseId: 'p5', blockingPhaseId: 'p4' }])

    // both gates resolved: the plan lands
    const publishAt = T('2026-09-10T09:00:00Z')
    const armed = normalizePlan(
      prepDone.map((p) => (p.id === 'p4' ? { ...p, opensPublicationId: 'pub-1' } : p)),
    )
    expect(
      reviewPlanEdit(
        armed,
        pubs({ 'pub-1': { status: 'scheduled', publishAt } }),
        T('2026-09-07T00:00:00Z'),
        {
          kind: 'set-planned',
          phaseId: 'p5',
          plannedEntryAt: T('2026-09-13T17:00:00Z'),
        },
      ).refusals,
    ).toEqual([])
  })

  it('never lands on a publication boundary: its time has a single source', () => {
    expect(
      reasonsOf(undefined, {
        kind: 'set-planned',
        phaseId: 'p4',
        plannedEntryAt: T('2026-09-10T09:00:00Z'),
      }),
    ).toEqual(['planned-on-publication-phase'])
  })
})

describe('boundaries only in the future, and in order', () => {
  it('refuses a planned time that is not in the future', () => {
    // an SLA on the manual close-out obeys the same clock, and nothing else
    expect(
      reasonsOf(undefined, { kind: 'set-planned', phaseId: 'p3', plannedEntryAt: NOW - 1 }),
    ).toEqual(['planned-not-in-future'])
    expect(
      reasonsOf(undefined, { kind: 'set-planned', phaseId: 'p3', plannedEntryAt: NOW + 60_000 }),
    ).toEqual([])
  })

  it('keeps committed instants monotonic along the queue', () => {
    const now = T('2026-08-25T00:00:00Z')
    const plan = normalizePlan([
      phase({ ordinal: 0, plannedEntryAt: T0, actualEntryAt: T0 }),
      phase({ ordinal: 1, plannedEntryAt: T1 }),
      phase({ ordinal: 2, plannedEntryAt: T2 }),
    ])
    expect(
      reviewPlanEdit(plan, NO_PUBS, now, {
        kind: 'set-planned',
        phaseId: 'p2',
        plannedEntryAt: T1 - 3_600_000,
      }).refusals,
    ).toEqual([{ reason: 'planned-out-of-order', phaseId: 'p2', blockingPhaseId: 'p1' }])
    expect(
      reviewPlanEdit(plan, NO_PUBS, now, {
        kind: 'set-planned',
        phaseId: 'p1',
        plannedEntryAt: T2 + 3_600_000,
      }).refusals,
    ).toEqual([{ reason: 'planned-out-of-order', phaseId: 'p1', blockingPhaseId: 'p2' }])

    // clearing back to 待定 is always a legitimate move on an unentered phase
    expect(
      reviewPlanEdit(plan, NO_PUBS, now, {
        kind: 'set-planned',
        phaseId: 'p2',
        plannedEntryAt: null,
      }).refusals,
    ).toEqual([])
  })
})

describe('offsets', () => {
  it('freeze once a plan exists: materialization turns the spec into provenance', () => {
    const plan = normalizePlan([
      phase({ ordinal: 0, entryTrigger: 'manual', actualEntryAt: T0 }),
      phase({ ordinal: 1, entryOffset: { days: 3 }, plannedEntryAt: T('2026-09-09T12:00:00Z') }),
      phase({ ordinal: 2, entryTrigger: 'manual' }),
    ])
    // neither changing nor clearing the spec behind a materialized plan
    for (const entryOffset of [{ days: 5 }, null]) {
      expect(
        reviewPlanEdit(plan, NO_PUBS, NOW, { kind: 'set-offset', phaseId: 'p1', entryOffset })
          .refusals,
      ).toEqual([{ reason: 'offset-with-planned', phaseId: 'p1' }])
    }
    // clearing the plan first releases the offset for editing
    const cleared = normalizePlan(
      plan.map((p) => (p.id === 'p1' ? { ...p, plannedEntryAt: null } : p)),
    )
    expect(
      reviewPlanEdit(cleared, NO_PUBS, NOW, {
        kind: 'set-offset',
        phaseId: 'p1',
        entryOffset: { days: 5 },
      }).refusals,
    ).toEqual([])
  })

  it('belong to scheduled phases and must be positive', () => {
    expect(
      reasonsOf(undefined, { kind: 'set-offset', phaseId: 'p4', entryOffset: { days: 1 } }),
    ).toEqual(['offset-on-non-scheduled-phase'])
    expect(
      reasonsOf(undefined, { kind: 'set-offset', phaseId: 'p5', entryOffset: { days: 0 } }),
    ).toEqual(['offset-not-positive'])
    expect(
      reasonsOf(undefined, {
        kind: 'set-offset',
        phaseId: 'p5',
        entryOffset: { days: -1, hours: 30 },
      }),
    ).toEqual(['offset-not-positive'])
    expect(
      reasonsOf(undefined, { kind: 'set-offset', phaseId: 'p5', entryOffset: { hours: 12 } }),
    ).toEqual([])
    expect(reasonsOf(undefined, { kind: 'set-offset', phaseId: 'p5', entryOffset: null })).toEqual(
      [],
    )
  })
})

describe('the publication binding lifecycle (§32.26)', () => {
  it('binds, rebinds and unbinds freely before entry, never after', () => {
    expect(
      reasonsOf(undefined, { kind: 'bind-publication', phaseId: 'p5', publicationId: 'pub-1' }),
    ).toEqual(['binding-on-non-publication-phase'])
    expect(
      reasonsOf(undefined, { kind: 'bind-publication', phaseId: 'p4', publicationId: 'pub-1' }),
    ).toEqual([])
    expect(
      reasonsOf(undefined, { kind: 'bind-publication', phaseId: 'p4', publicationId: null }),
    ).toEqual([])

    const publishAt = T('2026-09-10T09:00:00Z')
    const bound = normalizePlan(
      midFlight().map((p) =>
        p.id === 'p3'
          ? { ...p, actualEntryAt: T('2026-09-06T12:00:00Z') }
          : p.id === 'p4'
            ? { ...p, opensPublicationId: 'pub-1' }
            : p,
      ),
    )
    const lookup = pubs({ 'pub-1': { status: 'scheduled', publishAt } })
    // before the promise: rebinding is how "cancel and re-prepare" works
    expect(
      reviewPlanEdit(bound, lookup, publishAt - 1, {
        kind: 'bind-publication',
        phaseId: 'p4',
        publicationId: 'pub-2',
      }).refusals,
    ).toEqual([])
    // after it: which publication opened the phase is a historical fact,
    // whether or not the scheduler has materialized the entry
    expect(
      reviewPlanEdit(bound, lookup, publishAt + 1, {
        kind: 'bind-publication',
        phaseId: 'p4',
        publicationId: 'pub-2',
      }).refusals,
    ).toEqual([{ reason: 'binding-immutable-after-entry', phaseId: 'p4' }])
  })
})

describe('profiles', () => {
  it('accept only gated codes and lint proxy without submit', () => {
    const bad = reviewPlanEdit(midFlight(), NO_PUBS, NOW, {
      kind: 'set-profile',
      phaseId: 'p3',
      permissionProfile: ['auth.login', 'assessment.entry.submit'],
    })
    expect(bad.refusals).toEqual([
      { reason: 'profile-code-not-gated', phaseId: 'p3', code: 'auth.login' },
    ])

    const suspicious = reviewPlanEdit(midFlight(), NO_PUBS, NOW, {
      kind: 'set-profile',
      phaseId: 'p3',
      permissionProfile: ['assessment.entry.proxy'],
    })
    expect(suspicious.refusals).toEqual([])
    expect(suspicious.warnings).toEqual([{ reason: 'proxy-without-submit', phaseId: 'p3' }])

    const fine = reviewPlanEdit(midFlight(), NO_PUBS, NOW, {
      kind: 'set-profile',
      phaseId: 'p3',
      permissionProfile: ['assessment.entry.proxy', 'assessment.entry.submit'],
    })
    expect(fine.refusals).toEqual([])
    expect(fine.warnings).toEqual([])
  })
})

describe('insertion', () => {
  const spec = {
    phaseKey: 'supplementary-entry',
    displayName: 'Supplementary entry',
    entryTrigger: 'scheduled' as const,
  }

  it('lands strictly after the current phase and never after the terminal', () => {
    expect(
      reviewInsertion(midFlight(), NO_PUBS, NOW, 2, spec).refusals.map((r) => r.reason),
    ).toEqual(['insert-not-after-current'])
    expect(
      reviewInsertion(midFlight(), NO_PUBS, NOW, 8, spec).refusals.map((r) => r.reason),
    ).toEqual(['insert-after-terminal'])
    expect(reviewInsertion(midFlight(), NO_PUBS, NOW, 3, spec).refusals).toEqual([])
  })

  it("holds the new phase's fields to the same rules, at its position", () => {
    expect(
      reviewInsertion(midFlight(), NO_PUBS, NOW, 5, {
        ...spec,
        plannedEntryAt: T('2026-09-13T17:00:00Z'),
      }).refusals.map((r) => r.reason),
    ).toEqual(['hard-plan-beyond-event-boundary'])
    expect(
      reviewInsertion(midFlight(), NO_PUBS, NOW, 3, {
        ...spec,
        plannedEntryAt: T('2026-09-07T00:00:00Z'),
      }).refusals,
    ).toEqual([])
    expect(
      reviewInsertion(midFlight(), NO_PUBS, NOW, 3, {
        ...spec,
        entryTrigger: 'publication',
        plannedEntryAt: T('2026-09-07T00:00:00Z'),
      }).refusals.map((r) => r.reason),
    ).toEqual(['planned-on-publication-phase'])
    expect(
      reviewInsertion(midFlight(), NO_PUBS, NOW, 3, { ...spec, displayName: '  ' }).refusals.map(
        (r) => r.reason,
      ),
    ).toEqual(['display-name-blank'])
  })

  it('shifts the ordinals after the landing position', () => {
    expect(planInsertion(midFlight(), 3)).toEqual({
      ordinal: 3,
      shifted: [
        { phaseId: 'p3', ordinal: 4 },
        { phaseId: 'p4', ordinal: 5 },
        { phaseId: 'p5', ordinal: 6 },
        { phaseId: 'p6', ordinal: 7 },
        { phaseId: 'p7', ordinal: 8 },
      ],
    })
  })
})

describe('plan shape', () => {
  it('requires a manual terminal: the archive close-out is a human decision', () => {
    expect(reviewPlanShape(midFlight()).refusals).toEqual([])
    const runaway = normalizePlan([
      phase({ ordinal: 0, entryTrigger: 'manual' }),
      phase({ ordinal: 1, plannedEntryAt: T1 }),
    ])
    expect(reviewPlanShape(runaway).refusals).toEqual([
      { reason: 'terminal-must-be-manual', phaseId: 'p1' },
    ])
  })
})

describe('reviewPlan', () => {
  const spec = (
    over: Partial<Parameters<typeof reviewPlan>[0][number]> & { phaseKey: string },
  ) => ({
    displayName: over.phaseKey,
    entryTrigger: 'manual' as const,
    ...over,
  })

  it('holds a timeless review to every structural rule, only skipping the clock', () => {
    const specs = [
      spec({ phaseKey: 'prep' }),
      // a hard plan beyond a manual boundary is wrong in any month
      spec({
        phaseKey: 'entry',
        entryTrigger: 'scheduled',
        plannedEntryAt: T('2020-09-01T00:00:00Z'),
      }),
      spec({ phaseKey: 'archive' }),
    ]
    const timeless = reviewPlan(specs, null).refusals.map((r) => r.reason)
    expect(timeless).toContain('hard-plan-beyond-event-boundary')
    // the date being in the past is exactly what a stored template may say
    expect(timeless).not.toContain('planned-not-in-future')
    // with a clock the same plan also fails the future rule
    expect(reviewPlan(specs, NOW).refusals.map((r) => r.reason)).toContain('planned-not-in-future')
  })

  it('keeps commitments ordered and refuses an offset beside a plan, clock or not', () => {
    const disordered = reviewPlan(
      [
        spec({ phaseKey: 'late', entryTrigger: 'scheduled', plannedEntryAt: T2 }),
        spec({ phaseKey: 'early', entryTrigger: 'scheduled', plannedEntryAt: T1 }),
        spec({ phaseKey: 'archive' }),
      ],
      null,
    )
    expect(disordered.refusals.map((r) => r.reason)).toContain('planned-out-of-order')

    const combo = reviewPlan(
      [
        spec({
          phaseKey: 'entry',
          entryTrigger: 'scheduled',
          plannedEntryAt: T1,
          entryOffset: { days: 1 },
        }),
        spec({ phaseKey: 'archive' }),
      ],
      null,
    )
    expect(combo.refusals.map((r) => r.reason)).toContain('offset-with-planned')
  })
})
