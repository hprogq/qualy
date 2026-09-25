import { describe, expect, it } from 'vitest'
import { SELECTION_PHASES } from '../seed/selection.ts'
import { PHASES } from '../seed/term.ts'

// Both kinds of batch in the demonstration open re-examination in the same
// windows - while material is reviewed and while results may be appealed -
// and not while the appeals already made are settled.

const reopening = (phases: readonly { phaseKey: string; permissionProfile: readonly string[] }[]) =>
  phases
    .filter((phase) => phase.permissionProfile.includes('assessment.review.reopen'))
    .map((phase) => phase.phaseKey)

describe('re-examination windows', () => {
  it('are review and appeal in the school assessments', () => {
    expect(reopening(PHASES)).toEqual(['review', 'appeal'])
  })

  it('are review and appeal in the selection', () => {
    expect(reopening(SELECTION_PHASES)).toEqual(['review', 'appeal'])
  })
})
