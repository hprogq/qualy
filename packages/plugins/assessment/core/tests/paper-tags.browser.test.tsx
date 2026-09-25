import { describe, expect, it } from 'vitest'
import { standingRows } from '../src/client/entry/standing.ts'

// The one word each question's row wears on the paper. A settled claim
// under appeal keeps its approval or refusal while the round runs (§32.21),
// but it is not a refusal to act on: it is out with the reviewers.

const item = { id: 'item-1', title: '退役复学', status: 'active', itemType: 'evidence' }
const claim = (status: string, openRound: { origin: string } | null) => ({
  id: `entry-${status}`,
  itemId: item.id,
  status,
  openRound,
  supplement: null,
})

const tagOf = (entries: readonly unknown[]) =>
  standingRows({
    groups: [],
    items: [item] as never,
    entriesByItem: new Map([[item.id, entries]]) as never,
    standing: null,
  }).find((row) => row.id === item.id)?.tag

describe('the tag on a question with a claim under appeal', () => {
  it('reads a refusal under appeal as under review', () => {
    expect(tagOf([claim('rejected', null)])).toBe('rejected')
    expect(tagOf([claim('rejected', { origin: 'appeal' })])).toBe('in_review')
  })

  it('reads an approval under appeal as under review too', () => {
    expect(tagOf([claim('approved', null)])).toBe('approved')
    expect(tagOf([claim('approved', { origin: 'appeal' })])).toBe('in_review')
  })
})
