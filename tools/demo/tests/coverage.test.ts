import { describe, expect, it } from 'vitest'
import { duplicateClaimSummary, historyKind } from '../coverage.ts'

describe('duplicate claim coverage', () => {
  const claim = {
    batch_id: 'batch',
    participant_id: 'person',
    item_id: 'item',
    status: 'approved',
    activity: 'An activity',
    name: null,
    title: null,
    kind: null,
    term: null,
    duplicate_revoked: false,
  }

  it('rejects repeated events across unfinished, refused and approved submissions', () => {
    for (const status of ['draft', 'in_review', 'needs_revision', 'rejected', 'approved']) {
      expect(duplicateClaimSummary([claim, { ...claim, status }]).unexpected).toBe(1)
    }
    expect(duplicateClaimSummary([claim, claim, claim]).unexpected).toBe(1)
  })

  it('allows voided records and explicitly corrected rejected history without exempting a later approval', () => {
    expect(duplicateClaimSummary([claim, { ...claim, status: 'voided' }])).toEqual({
      unexpected: 0,
      explicitlyRejected: 0,
    })
    expect(
      duplicateClaimSummary([claim, { ...claim, status: 'rejected', duplicate_revoked: true }]),
    ).toEqual({ unexpected: 0, explicitlyRejected: 1 })
    expect(duplicateClaimSummary([claim, { ...claim, duplicate_revoked: true }]).unexpected).toBe(1)
  })

  it('separates people, projects, batches and explicitly different competition terms', () => {
    expect(
      duplicateClaimSummary([
        claim,
        { ...claim, participant_id: 'another-person' },
        { ...claim, item_id: 'another-item' },
        { ...claim, batch_id: 'another-batch' },
        { ...claim, term: 'another-term' },
      ]).unexpected,
    ).toBe(0)
  })

  it('uses a named competition or article title and distinguishes different research output kinds', () => {
    const competition = { ...claim, activity: null, name: 'A contest' }
    expect(duplicateClaimSummary([competition, { ...competition }]).unexpected).toBe(1)
    const article = { ...claim, activity: null, title: 'An article' }
    expect(duplicateClaimSummary([article, { ...article }]).unexpected).toBe(1)
    const project = { ...article, title: 'A project', kind: 'project-university' }
    expect(duplicateClaimSummary([project, { ...project, kind: 'software' }]).unexpected).toBe(0)
    expect(duplicateClaimSummary([project, { ...project }]).unexpected).toBe(1)
    expect(
      duplicateClaimSummary([
        { ...claim, activity: null },
        { ...claim, activity: null },
      ]),
    ).toEqual({
      unexpected: 0,
      explicitlyRejected: 0,
    })
  })
})

describe('current review history classification', () => {
  const initial = { revision_count: 1, origin: 'initial', answered: false, escalated: false }

  it('counts changed submitted material rather than the number of review rounds', () => {
    expect(historyKind(initial)).toBe('initial')
    expect(historyKind({ ...initial, revision_count: 2 })).toBe('revised')
    expect(historyKind({ ...initial, revision_count: 3 })).toBe('multiple-rounds')
    expect(historyKind({ ...initial, origin: 'reroute' })).toBe('reroute')
    expect(historyKind({ ...initial, origin: 'reroute', revision_count: 3 })).toBe('reroute')
  })

  it('distinguishes answered supplements, escalations, appeals and staff rechecks', () => {
    expect(historyKind({ ...initial, answered: true })).toBe('supplement-answered')
    expect(historyKind({ ...initial, escalated: true })).toBe('escalated')
    expect(historyKind({ ...initial, origin: 'appeal', answered: true })).toBe('appeal')
    expect(historyKind({ ...initial, origin: 'reopen', revision_count: 2 })).toBe('reopen')
  })
})
