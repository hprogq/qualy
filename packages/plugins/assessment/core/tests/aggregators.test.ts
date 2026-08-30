import { describe, expect, it } from 'vitest'
import { calcParticipant } from '../src/scoring/calc.ts'
import { builtinScoringDrivers, max1, scaledAmount, topNSum1 } from '../src/scoring/builtins.ts'

// The folding rules, held to their one obligation: every approved line is
// explained. "Only the highest office counts" is terms.md's own sentence,
// and an account whose lines do not add up to its total has to say, per
// line, why not.

const catalogs = {
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
      createdAt: 1,
      calculatorRef: 'fixed@1',
      aggregator,
      standing: 'scored' as const,
    },
  ],
  entries: [
    // three posts, two of them worth the same: the class monitor, filed
    // first, is the stable pick among equals
    { id: 'e1', itemId: 'i', standing: 'counted' as const, recognitionId: 'rec-e1', revisionId: 'r1', amount: scaledAmount('2.00'), createdAt: 1 },
    { id: 'e2', itemId: 'i', standing: 'counted' as const, recognitionId: 'rec-e2', revisionId: 'r2', amount: scaledAmount('2.00'), createdAt: 2 },
    { id: 'e3', itemId: 'i', standing: 'counted' as const, recognitionId: 'rec-e3', revisionId: 'r3', amount: scaledAmount('2.00'), createdAt: 3 },
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

/** the account as a reader adds it up: every printed line, in hundredths */
const addedUp = (values: readonly string[]) =>
  values.reduce((cents, value) => {
    const match = /^(-?)(\d+)\.(\d{2})$/.exec(value)
    if (!match) throw new Error(`not a two place amount: ${value}`)
    const magnitude = Number(match[2]) * 100 + Number(match[3])
    return cents + (match[1] === '-' ? -magnitude : magnitude)
  }, 0)

const finer = (spec: {
  value: string
  count: number
  cap?: string | null
  floor?: string | null
}) => ({
  groups: [
    {
      id: 'g',
      parentGroupId: null,
      name: '品德',
      cap: spec.cap ?? null,
      floor: spec.floor ?? null,
      sortOrder: 0,
    },
  ],
  items: [
    {
      id: 'i',
      title: '志愿服务',
      scoreGroupId: 'g',
      sortOrder: 0,
      createdAt: 1,
      calculatorRef: 'fixed@1',
      aggregator: { ref: 'sum@1', config: {} },
      standing: 'scored' as const,
    },
  ],
  entries: Array.from({ length: spec.count }, (_, index) => ({
    id: `e${index + 1}`,
    itemId: 'i',
    standing: 'counted' as const,
    recognitionId: `rec-e${index + 1}`,
    revisionId: `r${index + 1}`,
    // what fixed@1 answers for this configuration, evaluated upstream
    amount: scaledAmount(spec.value),
    createdAt: index + 1,
  })),
})

// §16: the quantum is the hundredth and the quantization point is the line.
// Configuration admits four decimals, so an account that adds unquantized
// contributions prints lines that do not reach the subtotal above them.
describe('the two place ledger', () => {
  it('quantizes every line, then adds the lines themselves up', () => {
    const account = calcParticipant(catalogs, finer({ value: '0.335', count: 3 }))
    expect(account.lines.map((line) => line.value)).toEqual(['0.34', '0.34', '0.34'])
    expect(account.groups[0]!.itemsTotal).toBe('1.02')
    expect(account.total).toBe('1.02')
    expect(addedUp(account.lines.map((line) => line.value))).toBe(
      addedUp([account.groups[0]!.final]),
    )
  })

  it('rounds a deduction away from zero, as the appeal desk has to explain', () => {
    const account = calcParticipant(catalogs, finer({ value: '-0.125', count: 1 }))
    expect(account.lines[0]!.value).toBe('-0.13')
    expect(account.total).toBe('-0.13')
    // 83.245 the same way: the answer a pocket calculator gives
    const award = calcParticipant(catalogs, finer({ value: '83.245', count: 1 }))
    expect(award.total).toBe('83.25')
  })

  it('applies a limit at the hundredth it is printed in', () => {
    const account = calcParticipant(catalogs, finer({ value: '1.00', count: 3, cap: '2.005' }))
    const group = account.groups[0]!
    expect(group.cap).toBe('2.01')
    expect(group.final).toBe('2.01')
    const adjustment = account.lines.find((line) => line.kind === 'group-adjustment')!
    expect(adjustment.value).toBe('-0.99')
    expect(addedUp(account.lines.map((line) => line.value))).toBe(addedUp([account.total]))
  })
})
