import { describe, expect, it } from 'vitest'
import {
  BATCH_STAFF_CODES,
  OFFERED_PHASE_CODES,
  PHASE_GATED,
  UNOFFERED_CODES,
  permissions,
} from '../src/permissions.ts'
import { reviewPlanEdit } from '../src/phase/engine/edits.ts'
import { normalizePlan } from '../src/phase/engine/queue.ts'
import { phase, T } from './support/plan.ts'

// Codes the product has named but does not offer yet (ruling of 2026-09-25
// #22): nobody may be granted them, a batch may not accept them and a stage
// editor does not list them - and a stage profile that already names one
// is still a profile the plan accepts, so no stored plan stops saving.

describe('codes the product does not offer yet', () => {
  it('are in neither the catalog, a batch, nor the stage editor', () => {
    expect([...UNOFFERED_CODES].sort()).toEqual([
      'assessment.entry.proxy',
      'assessment.publication.manage',
    ])
    const catalog: readonly string[] = permissions.map((definition) => definition.code)
    for (const code of UNOFFERED_CODES) {
      expect(catalog).not.toContain(code)
      expect(BATCH_STAFF_CODES as readonly string[]).not.toContain(code)
      expect(OFFERED_PHASE_CODES as readonly string[]).not.toContain(code)
    }
  })

  it('leaves a stored stage profile that names one valid', () => {
    expect(PHASE_GATED.has('assessment.entry.proxy')).toBe(true)
    const reviewed = reviewPlanEdit(
      normalizePlan([
        phase({ ordinal: 0, displayName: 'Entry', actualEntryAt: T('2026-09-01T00:00:00Z') }),
        phase({ ordinal: 1, displayName: 'Review' }),
      ]),
      T('2026-09-05T12:00:00Z'),
      {
        kind: 'set-profile',
        phaseId: 'p1',
        permissionProfile: ['assessment.entry.submit', 'assessment.entry.proxy'],
      },
    )
    expect(reviewed.refusals).toEqual([])
  })
})
