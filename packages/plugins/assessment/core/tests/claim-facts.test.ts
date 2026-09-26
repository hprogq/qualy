import { describe, expect, it } from 'vitest'
import {
  claimActOf,
  claimAsked,
  claimFilesOf,
  claimNoteOf,
  type ClaimFactsSource,
} from '../src/client/entry/claim-facts.ts'

// What every list of claims says of one beside its name, read once: the
// score page's rows and the filing page's rows ask the same questions of
// the same claim and must not answer them two ways.

const claim = (over: Partial<ClaimFactsSource> & Pick<ClaimFactsSource, 'status'>) => ({
  createdAt: '2026-03-01T00:00:00.000Z',
  currentRevision: { payload: {}, createdAt: '2026-03-02T00:00:00.000Z' },
  supplement: null,
  recognition: null,
  refusal: null,
  ...over,
})

const ask = (instructions: string) => ({
  requestId: 'ask',
  instructions,
  requestedAt: '2026-03-05T00:00:00.000Z',
})

describe('the last thing that happened to a claim', () => {
  it('puts an open ask for material before the claim’s own state', () => {
    expect(claimActOf(claim({ status: 'in_review', supplement: ask('stamp') }))).toEqual({
      act: 'asked',
      at: '2026-03-05T00:00:00.000Z',
    })
    expect(claimAsked(claim({ status: 'in_review', supplement: ask('stamp') }))).toBe(true)
    expect(claimAsked(claim({ status: 'in_review' }))).toBe(false)
  })

  it('dates a return or a refusal by the decision, and a decision by its recognition', () => {
    const refusal = { at: '2026-03-06T00:00:00.000Z', comment: 'blurred' }
    expect(claimActOf(claim({ status: 'needs_revision', refusal }))).toEqual({
      act: 'returned',
      at: '2026-03-06T00:00:00.000Z',
    })
    expect(claimActOf(claim({ status: 'rejected', refusal }))).toEqual({
      act: 'refused',
      at: '2026-03-06T00:00:00.000Z',
    })
    const recognition = { createdAt: '2026-03-10T00:00:00.000Z' }
    expect(claimActOf(claim({ status: 'approved', recognition }))).toEqual({
      act: 'approved',
      at: '2026-03-10T00:00:00.000Z',
    })
    expect(claimActOf(claim({ status: 'in_review' })).act).toBe('submitted')
    expect(claimActOf(claim({ status: 'draft' })).act).toBe('saved')
  })

  it('says a fact the office recorded was recorded or revoked, and one its owner gave up was abandoned', () => {
    expect(claimActOf(claim({ status: 'approved', source: 'record' })).act).toBe('recorded')
    expect(claimActOf(claim({ status: 'approved', source: 'import' })).act).toBe('recorded')
    expect(claimActOf(claim({ status: 'voided', source: 'record' })).act).toBe('revoked')
    expect(claimActOf(claim({ status: 'voided', source: 'self' })).act).toBe('abandoned')
  })
})

describe('a reviewer’s words on a claim', () => {
  it('carries what to add, why it came back and why it was refused, and nothing blank', () => {
    expect(claimNoteOf(claim({ status: 'in_review', supplement: ask('  stamp  ') }))).toEqual({
      kind: 'ask',
      text: 'stamp',
    })
    expect(claimNoteOf(claim({ status: 'in_review', supplement: ask('   ') }))).toBeNull()
    expect(
      claimNoteOf(claim({ status: 'needs_revision', refusal: { comment: null, reason: 'late' } })),
    ).toEqual({ kind: 'return', text: 'late' })
    expect(claimNoteOf(claim({ status: 'rejected', refusal: { comment: 'no' } }))).toEqual({
      kind: 'refusal',
      text: 'no',
    })
    // words from a decision the claim no longer stands at are not carried
    expect(claimNoteOf(claim({ status: 'approved', refusal: { comment: 'old' } }))).toBeNull()
  })
})

describe('the files a claim holds', () => {
  const form = {
    fields: [
      { key: 'proof', type: 'attachment' },
      { key: 'photos', type: 'attachment' },
      { key: 'name', type: 'text' },
      { key: 'constructor', type: 'attachment' },
    ],
  }

  it('counts the files in its current version’s own file fields', () => {
    const filed = claim({
      status: 'in_review',
      currentRevision: {
        payload: { proof: ['a', 'b'], photos: ['c'], name: ['not', 'a', 'file'] },
        createdAt: '2026-03-02T00:00:00.000Z',
      },
    })
    expect(claimFilesOf(filed, form)).toBe(3)
    expect(claimFilesOf(filed, null)).toBe(0)
    expect(claimFilesOf(claim({ status: 'draft', currentRevision: null }), form)).toBe(0)
  })
})
