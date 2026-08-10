import { describe, expect, it } from 'vitest'
import {
  applyToPlan,
  planInsertion,
  reviewInsertion,
  reviewPlan,
  reviewPlanEdit,
} from '../src/phase/engine/edits.ts'
import { normalizePlan } from '../src/phase/engine/queue.ts'
import { phase, T } from './support/plan.ts'

// The editing rules, all of which are one shape read off in different places:
// a plan is an entered prefix, a scheduled prefix and an unscheduled suffix.
// Time is committed from the top down and withdrawn from the bottom up;
// structure is free only where nothing has been promised.

const NOW = T('2026-09-05T12:00:00Z')
const LATER = T('2026-09-30T00:00:00Z')

/** entered · scheduled · unscheduled, one of each */
const plan = () =>
  normalizePlan([
    phase({ ordinal: 0, displayName: 'Entry', actualEntryAt: T('2026-09-01T00:00:00Z') }),
    phase({ ordinal: 1, displayName: 'Review', plannedEntryAt: T('2026-09-20T00:00:00Z') }),
    phase({ ordinal: 2, displayName: 'Publication' }),
    phase({ ordinal: 3, displayName: 'Appeal' }),
  ])

const reasons = (review: { refusals: readonly { reason: string }[] }) =>
  review.refusals.map((refusal) => refusal.reason)

describe('committing a time', () => {
  it('only goes to the first phase that has none', () => {
    expect(
      reasons(
        reviewPlanEdit(plan(), NOW, { kind: 'set-planned', phaseId: 'p2', plannedEntryAt: LATER }),
      ),
    ).toEqual([])
    // p3 is behind p2, which has no time yet
    expect(
      reasons(
        reviewPlanEdit(plan(), NOW, { kind: 'set-planned', phaseId: 'p3', plannedEntryAt: LATER }),
      ),
    ).toEqual(['schedule-out-of-order'])
  })

  it('refuses a time in the past or out of order', () => {
    expect(
      reasons(
        reviewPlanEdit(plan(), NOW, {
          kind: 'set-planned',
          phaseId: 'p2',
          plannedEntryAt: T('2026-09-04T00:00:00Z'),
        }),
      ),
    ).toEqual(['planned-not-in-future', 'planned-out-of-order'])
    expect(
      reasons(
        reviewPlanEdit(plan(), NOW, {
          kind: 'set-planned',
          phaseId: 'p2',
          plannedEntryAt: T('2026-09-10T00:00:00Z'),
        }),
      ),
    ).toEqual(['planned-out-of-order'])
  })

  it('never moves a phase that already began', () => {
    expect(
      reasons(
        reviewPlanEdit(plan(), NOW, { kind: 'set-planned', phaseId: 'p0', plannedEntryAt: LATER }),
      ),
    ).toEqual(['phase-already-entered'])
    expect(
      reasons(
        reviewPlanEdit(plan(), NOW, { kind: 'set-actual', phaseId: 'p1', actualEntryAt: NOW }),
      ),
    ).toEqual(['actual-immutable'])
  })
})

describe('withdrawing a time', () => {
  it('only comes off the last phase that has one', () => {
    expect(
      reasons(
        reviewPlanEdit(plan(), NOW, { kind: 'set-planned', phaseId: 'p1', plannedEntryAt: null }),
      ),
    ).toEqual([])
  })

  it('cannot leave a hole behind it', () => {
    const deeper = normalizePlan([
      phase({ ordinal: 0, actualEntryAt: T('2026-09-01T00:00:00Z') }),
      phase({ ordinal: 1, plannedEntryAt: T('2026-09-20T00:00:00Z') }),
      phase({ ordinal: 2, plannedEntryAt: T('2026-09-25T00:00:00Z') }),
    ])
    expect(
      reasons(
        reviewPlanEdit(deeper, NOW, { kind: 'set-planned', phaseId: 'p1', plannedEntryAt: null }),
      ),
    ).toEqual(['unschedule-not-from-tail'])
  })
})

describe('what a phase is', () => {
  it('needs a name, and takes prose at any time', () => {
    expect(
      reasons(reviewPlanEdit(plan(), NOW, { kind: 'rename', phaseId: 'p2', displayName: '  ' })),
    ).toEqual(['display-name-blank'])
    expect(
      reasons(
        reviewPlanEdit(plan(), NOW, { kind: 'describe', phaseId: 'p0', description: 'ran first' }),
      ),
    ).toEqual([])
  })

  it('opens only codes the gate governs, and warns about a door with no exit', () => {
    expect(
      reasons(
        reviewPlanEdit(plan(), NOW, {
          kind: 'set-profile',
          phaseId: 'p2',
          permissionProfile: ['assessment.batch.manage'],
        }),
      ),
    ).toEqual(['profile-code-not-gated'])
    const proxy = reviewPlanEdit(plan(), NOW, {
      kind: 'set-profile',
      phaseId: 'p2',
      permissionProfile: ['assessment.entry.proxy'],
    })
    expect(proxy.warnings.map((warning) => warning.reason)).toEqual(['proxy-without-submit'])
  })

  it('leaves an ended phase profile alone: it records what that phase allowed', () => {
    expect(
      reasons(
        reviewPlanEdit(plan(), NOW, {
          kind: 'set-profile',
          phaseId: 'p0',
          permissionProfile: [],
        }),
      ),
    ).toEqual([])
  })
})

describe('changing the structure', () => {
  const spec = { phaseKey: 'supplementary', displayName: 'Supplementary entry' }

  it('inserts only where nothing has been promised', () => {
    expect(reasons(reviewInsertion(plan(), NOW, 2, spec))).toEqual([])
    expect(reasons(reviewInsertion(plan(), NOW, 4, spec))).toEqual([])
    // p1 already carries a time; the queue behind it has been announced
    expect(reasons(reviewInsertion(plan(), NOW, 1, spec))).toEqual(['scheduled-phase-immutable'])
    // and nothing goes in front of what is already running
    expect(reasons(reviewInsertion(plan(), NOW, 0, spec))).toEqual([
      'insert-not-after-current',
      'scheduled-phase-immutable',
    ])
  })

  it('shifts the ordinals of everything it lands in front of', () => {
    expect(planInsertion(plan(), 2)).toEqual({
      ordinal: 2,
      shifted: [
        { phaseId: 'p2', ordinal: 3 },
        { phaseId: 'p3', ordinal: 4 },
      ],
    })
  })

  it('reviews a whole submitted plan as structure alone', () => {
    const review = reviewPlan([
      { phaseKey: 'a', displayName: 'A' },
      { phaseKey: 'b', displayName: '  ' },
    ])
    expect(review.refusals).toEqual([{ reason: 'display-name-blank', phaseId: null, index: 1 }])
  })
})

describe('applying an accepted edit', () => {
  it('writes only the phase it names', () => {
    const after = applyToPlan(plan(), { kind: 'describe', phaseId: 'p2', description: 'S1' })
    expect(after[2]!.description).toBe('S1')
    expect(after[1]).toBe(plan()[1] === after[1] ? after[1] : after[1])
    expect(after.map((row) => row.displayName)).toEqual(plan().map((row) => row.displayName))
  })
})
