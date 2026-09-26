import { describe, expect, it } from 'vitest'
import { refilesNow, takenUpAtRandom } from '../seed/term.ts'

// A claim moved onto a changed route is looked at both by the review
// scheduled when it was sent and by the one the move schedules. Twice a full
// seeding run stopped in its last term because the second found the claim
// passed up, refused it as a first-route claim and queued it to be filed
// again, which the product refused. These hold the two turns that keep it
// from happening.

describe('the random review of the first route', () => {
  it('takes up a round on the first route', () => {
    expect(takenUpAtRandom({ chain: { route: 'normal' } })).toBe(true)
  })

  it('leaves a round passed up to the escalation route to its own walk', () => {
    // a refusal there is one step's opinion, and the claim stays under review
    expect(takenUpAtRandom({ chain: { route: 'escalation' } })).toBe(false)
  })
})

describe('a resubmission queued after a refusal', () => {
  it('goes ahead while the claim still stands refused', () => {
    expect(refilesNow('rejected')).toBe(true)
  })

  it('is dropped once the claim stands otherwise when its moment comes', () => {
    for (const status of ['in_review', 'approved', 'needs_revision', 'draft', undefined]) {
      expect(refilesNow(status), String(status)).toBe(false)
    }
  })
})
