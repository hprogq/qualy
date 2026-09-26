import { describe, expect, it } from 'vitest'
import type { ItemDto } from '../src/client/entry/model.ts'
import { freshDraft, scopesToSend, type PhaseDraft } from '../src/client/phase/model.ts'
import { narrowsByItem, scopeSections } from '../src/client/phase/scope.ts'

// What the stage panel asks before it offers an item allowance, what it lists
// to choose from, and what a save says about an allowance. The gate is the
// one authority on which actions an allowance narrows; the save must never
// restate an allowance nobody touched, because a stage that has ended refuses
// even an unchanged one.

describe('which stages an item allowance can narrow', () => {
  it('is a stage that opens filing or recording, and never one that only reviews', () => {
    expect(narrowsByItem(['assessment.entry.create'])).toBe(true)
    expect(narrowsByItem(['assessment.entry.record'])).toBe(true)
    expect(narrowsByItem(['assessment.review.process', 'assessment.review.reopen'])).toBe(false)
    // an appeal is about a conclusion already reached, which names no new item
    expect(narrowsByItem(['assessment.entry.appeal'])).toBe(false)
    expect(narrowsByItem([])).toBe(false)
  })
})

describe('what the allowance is chosen from', () => {
  const item = (id: string, group: string, status: string, sortOrder: number): ItemDto => ({
    id,
    batchId: 'batch',
    itemType: 'evidence',
    title: id,
    scoreGroupId: group,
    maxEntries: null,
    sortOrder,
    status,
    voidReason: null,
    currentRevision: null,
    createdAt: '2026-03-01T00:00:00.000Z',
  })
  const groups = [
    { id: 'paper', parentGroupId: null, name: 'paper', cap: null, floor: null, sortOrder: 0 },
    { id: 'later', parentGroupId: 'paper', name: 'later', cap: null, floor: null, sortOrder: 1 },
    { id: 'first', parentGroupId: 'paper', name: 'first', cap: null, floor: null, sortOrder: 0 },
  ]
  const items = [
    item('language', 'later', 'active', 0),
    item('contest', 'first', 'active', 1),
    item('dormitory', 'later', 'voided', 2),
    item('sports', 'later', 'draft', 3),
  ]

  it('lists the paper section by section, in the order it reads', () => {
    const sections = scopeSections(groups, items, [])
    expect(sections.map((section) => section.title)).toEqual(['1 first', '2 later'])
    expect(sections[1]!.items.map((one) => [one.id, one.status])).toEqual([
      ['language', 'active'],
      ['sports', 'draft'],
    ])
  })

  it('keeps a withdrawn item only while the allowance still names it', () => {
    const sections = scopeSections(groups, items, ['dormitory'])
    expect(sections[1]!.items.map((one) => one.id)).toContain('dormitory')
  })
})

describe('what a save says about an allowance', () => {
  const stored: PhaseDraft = {
    ...freshDraft([]),
    id: 'phase',
    itemScope: ['b', 'a'],
    participantScope: ['p'],
  }

  it('says nothing about an allowance nobody touched, in whatever order it was ticked', () => {
    expect(scopesToSend({ ...stored, itemScope: ['a', 'b'] }, stored)).toEqual({})
  })

  it('states a changed allowance, and a cleared one as cleared', () => {
    expect(scopesToSend({ ...stored, itemScope: ['a'] }, stored)).toEqual({ itemScope: ['a'] })
    expect(scopesToSend({ ...stored, participantScope: [] }, stored)).toEqual({
      participantScope: [],
    })
  })

  it('states an allowance on a new stage only when it has one', () => {
    const fresh = freshDraft([])
    expect(scopesToSend(fresh, undefined)).toEqual({})
    expect(scopesToSend({ ...fresh, itemScope: ['a'] }, undefined)).toEqual({ itemScope: ['a'] })
  })
})
