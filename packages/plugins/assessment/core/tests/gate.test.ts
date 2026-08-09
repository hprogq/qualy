import { describe, expect, it } from 'vitest'
import { gateAllows, type GateContext } from '../src/phase/gate.ts'

// The permission matrix, cell by cell (§11): the gate only narrows, fails
// closed without a phase, and a scoped supplementary phase narrows further
// by item and participant - with review work exempt by design.

const NONE = new Set<string>()

const decide = (
  code: string,
  profile: readonly string[] | null,
  scopes: { item?: ReadonlySet<string>; participant?: ReadonlySet<string> } = {},
  ctx?: GateContext,
) =>
  gateAllows({
    code,
    profile,
    itemScope: scopes.item ?? NONE,
    participantScope: scopes.participant ?? NONE,
    ...(ctx !== undefined ? { ctx } : {}),
  })

// the default matrix rows this milestone ships (§11)
const PRE_ENTRY = ['assessment.entry.create', 'assessment.entry.edit', 'assessment.entry.record']
const ENTRY = [
  'assessment.entry.create',
  'assessment.entry.edit',
  'assessment.entry.submit',
  'assessment.entry.withdraw',
  'assessment.entry.proxy',
  'assessment.entry.record',
  'assessment.review.process',
]
const REVIEW = ['assessment.entry.record', 'assessment.review.process', 'assessment.review.reopen']
const PUBLICATION_PREP: string[] = []

describe('the phase gate matrix', () => {
  it('opens exactly what the profile names, cell by cell', () => {
    // pre-entry: drafting allowed, submitting not
    expect(decide('assessment.entry.create', PRE_ENTRY)).toEqual({ allowed: true })
    expect(decide('assessment.entry.edit', PRE_ENTRY)).toEqual({ allowed: true })
    expect(decide('assessment.entry.submit', PRE_ENTRY)).toEqual({
      allowed: false,
      reason: 'phase-closed',
    })
    expect(decide('assessment.entry.proxy', PRE_ENTRY)).toEqual({
      allowed: false,
      reason: 'phase-closed',
    })

    // formal entry: submission and proxy open, review runs in parallel
    expect(decide('assessment.entry.submit', ENTRY)).toEqual({ allowed: true })
    expect(decide('assessment.entry.proxy', ENTRY)).toEqual({ allowed: true })
    expect(decide('assessment.review.process', ENTRY)).toEqual({ allowed: true })

    // review wrap-up: submission closed, review continues, records still land
    expect(decide('assessment.entry.submit', REVIEW)).toEqual({
      allowed: false,
      reason: 'phase-closed',
    })
    expect(decide('assessment.entry.create', REVIEW)).toEqual({
      allowed: false,
      reason: 'phase-closed',
    })
    expect(decide('assessment.review.process', REVIEW)).toEqual({ allowed: true })
    expect(decide('assessment.entry.record', REVIEW)).toEqual({ allowed: true })

    // publication prep and the archive: every gated action refused
    for (const code of [
      'assessment.entry.create',
      'assessment.entry.submit',
      'assessment.entry.record',
      'assessment.review.process',
      'assessment.ranking.view',
    ]) {
      expect(decide(code, PUBLICATION_PREP)).toEqual({ allowed: false, reason: 'phase-closed' })
    }
  })

  it('never touches ungated codes and fails closed without a phase', () => {
    // management and self-service codes pass whatever the phase says
    expect(decide('assessment.batch.manage', PUBLICATION_PREP)).toEqual({ allowed: true })
    expect(decide('assessment.result.view-self', null)).toEqual({ allowed: true })
    // a gated code with no phase in effect is shut, not open
    expect(decide('assessment.entry.submit', null)).toEqual({
      allowed: false,
      reason: 'no-active-phase',
    })
    // a code the profile names beyond the registry would still be gated by
    // profile membership; a gated code missing from an old profile is shut
    expect(decide('assessment.entry.resubmit', ENTRY)).toEqual({
      allowed: false,
      reason: 'phase-closed',
    })
  })

  it('narrows a scoped phase by item for the creation family only', () => {
    const item = new Set(['item-a'])
    const profile = [
      'assessment.entry.create',
      'assessment.entry.resubmit',
      'assessment.review.process',
    ]
    expect(decide('assessment.entry.create', profile, { item }, { itemId: 'item-a' })).toEqual({
      allowed: true,
    })
    expect(decide('assessment.entry.create', profile, { item }, { itemId: 'item-b' })).toEqual({
      allowed: false,
      reason: 'item-out-of-scope',
    })
    // creating without naming an item cannot be inside the allowance
    expect(decide('assessment.entry.create', profile, { item })).toEqual({
      allowed: false,
      reason: 'item-out-of-scope',
    })
    // resubmit anchors a publication row, item-agnostic by design
    expect(decide('assessment.entry.resubmit', profile, { item })).toEqual({ allowed: true })
    // review is never scoped: whatever the phase admits must be reviewable
    expect(decide('assessment.review.process', profile, { item })).toEqual({ allowed: true })
  })

  it('narrows a scoped phase by participant for the whole entry family', () => {
    const participant = new Set(['p-1'])
    const profile = [
      'assessment.entry.create',
      'assessment.entry.submit',
      'assessment.entry.resubmit',
      'assessment.review.reopen',
    ]
    expect(
      decide('assessment.entry.submit', profile, { participant }, { participantId: 'p-1' }),
    ).toEqual({ allowed: true })
    expect(
      decide('assessment.entry.submit', profile, { participant }, { participantId: 'p-2' }),
    ).toEqual({ allowed: false, reason: 'participant-out-of-scope' })
    // resubmit ignores the item allowance but honors this one
    expect(
      decide(
        'assessment.entry.resubmit',
        profile,
        { item: new Set(['item-a']), participant },
        { participantId: 'p-2' },
      ),
    ).toEqual({ allowed: false, reason: 'participant-out-of-scope' })
    expect(decide('assessment.review.reopen', profile, { participant })).toEqual({ allowed: true })
  })
})
