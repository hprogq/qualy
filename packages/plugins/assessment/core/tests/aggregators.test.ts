import { describe, expect, it } from 'vitest'
import { calcParticipant } from '../src/scoring/calc.ts'
import { builtinScoringDrivers, max1, topNSum1 } from '../src/scoring/builtins.ts'

// The folding rules, held to their one obligation: every approved line is
// explained. "Only the highest office counts" is terms.md's own sentence,
// and an account whose lines do not add up to its total has to say, per
// line, why not.

const catalogs = {
  calculators: new Map(
    builtinScoringDrivers.filter((d) => d.kind === 'calculator').map((d) => [d.ref, d]),
  ),
  aggregators: new Map(
    builtinScoringDrivers.filter((d) => d.kind === 'aggregator').map((d) => [d.ref, d]),
  ),
}

const officer = (aggregator: { ref: string; config: unknown }) => ({
  groups: [{ id: 'g', parentGroupId: null, name: '文体', cap: null, floor: null, sortOrder: 0 }],
  items: [
    {
      id: 'i',
      title: '学生干部任职',
      scoreGroupId: 'g',
      sortOrder: 0,
      status: 'active',
      createdAt: 1,
      calculator: { ref: 'fixed@1', config: { value: '2.00' } },
      aggregator,
    },
  ],
  entries: [
    // three posts, two of them worth the same: the class monitor, filed
    // first, is the stable pick among equals
    { id: 'e1', itemId: 'i', status: 'approved', revisionId: 'r1', payload: {}, createdAt: 1 },
    { id: 'e2', itemId: 'i', status: 'approved', revisionId: 'r2', payload: {}, createdAt: 2 },
    { id: 'e3', itemId: 'i', status: 'approved', revisionId: 'r3', payload: {}, createdAt: 3 },
  ],
})

describe('the folding rules', () => {
  it('max@1 counts one line and explains the rest at zero', () => {
    const account = calcParticipant(catalogs, officer({ ref: 'max@1', config: {} }))
    // two posts at 2.00 each would sum to 4; the policy answer is 2
    expect(account.total).toBe('2.00')
    expect(account.lines.map((line) => [line.kind, line.value])).toEqual([
      ['entry', '2.00'],
      ['entry-not-counted', '0.00'],
      ['entry-not-counted', '0.00'],
    ])
  })

  it('top-n-sum@1 keeps the best few', () => {
    const account = calcParticipant(catalogs, officer({ ref: 'top-n-sum@1', config: { n: 2 } }))
    expect(account.total).toBe('4.00')
    expect(account.lines.filter((line) => line.kind === 'entry')).toHaveLength(2)
    expect(account.lines.filter((line) => line.kind === 'entry-not-counted')).toHaveLength(1)
  })

  it('sum@1 counts everything, as it always did', () => {
    const account = calcParticipant(catalogs, officer({ ref: 'sum@1', config: {} }))
    expect(account.total).toBe('6.00')
    expect(account.lines.every((line) => line.kind === 'entry')).toBe(true)
  })

  it('selection is by amount first, filing order among equals', () => {
    const picked = max1.aggregate({}, [
      { entryId: 'low', amount: 15000n },
      { entryId: 'first-high', amount: 20000n },
      { entryId: 'second-high', amount: 20000n },
    ])
    expect(picked.total).toBe(20000n)
    expect(picked.entries.map((entry) => [entry.entryId, entry.included])).toEqual([
      ['low', false],
      ['first-high', true],
      ['second-high', false],
    ])
    expect(picked.entries[0]!.reason).toBe('not-selected')
    const top = topNSum1.aggregate(
      { n: 2 },
      picked.entries.map((e) => ({
        entryId: e.entryId,
        amount: e.entryId === 'low' ? 15000n : 20000n,
      })),
    )
    expect(top.total).toBe(40000n)
  })
})
