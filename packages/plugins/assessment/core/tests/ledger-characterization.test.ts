import { describe, expect, it } from 'vitest'
import { calcParticipant } from '../src/scoring/calc.ts'
import { builtinScoringDrivers, scaledAmount } from '../src/scoring/builtins.ts'

// What the ledger answers today, written down before the arithmetic moves.
//
// Phase 5 lifts amount evaluation out of the pure ledger and puts recognized
// facts in front of it. Every number here was produced by the pre-Phase-5
// path and must survive that move untouched: the differential gate is this
// file, and a diff in any literal below is a business change nobody asked
// for. It is deliberately broader than the folding suite - negatives, the
// four-decimal configs, nested caps and floors, ties, and every entry state
// that does or does not reach the account.

const catalogs = {
  aggregators: new Map(
    builtinScoringDrivers.filter((d) => d.kind === 'aggregator').map((d) => [d.ref, d]),
  ),
}

// The amounts arrive evaluated now; these fixtures name what fixed@1 would
// have answered, which is the configured amount verbatim.
const amount = (value: string) => scaledAmount(value)

const group = (
  id: string,
  extra: Partial<{
    parentGroupId: string | null
    cap: string | null
    floor: string | null
    sortOrder: number
  }> = {},
) => ({
  id,
  parentGroupId: null,
  name: id,
  cap: null,
  floor: null,
  sortOrder: 0,
  ...extra,
})

interface Fixture {
  readonly id: string
  /** what this question's calculator answers - fixed@1 answers its config */
  readonly worth: string
  readonly scoreGroupId?: string
  readonly aggregator?: { ref: string; config: unknown }
  readonly status?: string
  readonly derived?: boolean
  readonly sortOrder?: number
}

interface EntryFixture {
  readonly id: string
  readonly itemId: string
  readonly status?: string
  readonly revisionId?: string | null
  readonly createdAt?: number
}

/**
 * The ledger's input, with amounts already evaluated - which is the whole
 * point of the split: what an entry is worth was decided upstream, and this
 * fixture states it the way the evaluator would hand it over.
 */
const account = (fixture: {
  readonly groups: readonly ReturnType<typeof group>[]
  readonly items: readonly Fixture[]
  readonly entries?: readonly EntryFixture[]
}) => {
  const worth = new Map(fixture.items.map((item) => [item.id, scaledAmount(item.worth)]))
  return calcParticipant(catalogs, {
    groups: fixture.groups,
    items: fixture.items.map((item) => ({
      id: item.id,
      title: item.id,
      scoreGroupId: item.scoreGroupId ?? 'g',
      sortOrder: item.sortOrder ?? 0,
      status: item.status ?? 'active',
      createdAt: 1,
      calculatorRef: 'fixed@1',
      aggregator: item.aggregator ?? { ref: 'sum@1', config: {} },
      ...(item.derived === true
        ? { derived: true as const, derivedAmount: worth.get(item.id)! }
        : {}),
    })),
    entries: (fixture.entries ?? []).map((one) => {
      const base = {
        id: one.id,
        itemId: one.itemId,
        revisionId: one.revisionId === undefined ? `r-${one.id}` : one.revisionId,
        createdAt: one.createdAt ?? 1,
      }
      const status = one.status ?? 'approved'
      return status === 'approved'
        ? { ...base, status: 'approved' as const, amount: worth.get(one.itemId) ?? 0n }
        : {
            ...base,
            status: status as 'draft' | 'in_review' | 'needs_revision' | 'rejected' | 'voided',
          }
    }),
  })
}

const lines = (account: ReturnType<typeof calcParticipant>) =>
  account.lines.map((line) => [line.lineId, line.kind, line.value])

describe('what the ledger answers, frozen', () => {
  it('sums, picks the highest, and takes the top two - with every line explained', () => {
    for (const [aggregator, total, shape] of [
      [{ ref: 'sum@1', config: {} }, '6.00', ['entry', 'entry', 'entry']],
      [{ ref: 'max@1', config: {} }, '2.00', ['entry', 'entry-not-counted', 'entry-not-counted']],
      [
        { ref: 'top-n-sum@1', config: { n: 2 } },
        '4.00',
        ['entry', 'entry', 'entry-not-counted'],
      ],
    ] as const) {
      const result = account({
        groups: [group('g')],
        items: [{ id: 'i', worth: '2.00', aggregator }],
        entries: [{ id: 'e1', itemId: 'i' }, { id: 'e2', itemId: 'i', createdAt: 2 }, { id: 'e3', itemId: 'i', createdAt: 3 }],
      })
      expect(result.total, aggregator.ref).toBe(total)
      expect(result.lines.map((line) => line.kind), aggregator.ref).toEqual(shape)
    }
  })

  it('carries negative amounts and four-decimal configs to the display quantum', () => {
    const result = account({
      groups: [group('g')],
      items: [
        { id: 'penalty', worth: '-1.5000' },
        { id: 'third', worth: '0.3333', sortOrder: 1 },
        { id: 'half-up', worth: '0.1250', sortOrder: 2 },
        { id: 'half-down-negative', worth: '-0.1250', sortOrder: 3 },
      ],
      entries: [
        { id: 'a', itemId: 'penalty' },
        { id: 'b', itemId: 'third' },
        { id: 'c', itemId: 'half-up' },
        { id: 'd', itemId: 'half-down-negative' },
      ],
    })
    // each line quantizes to two places, half away from zero, and the total
    // is the exact sum of the printed lines
    expect(lines(result)).toEqual([
      ['entry:a', 'entry', '-1.50'],
      ['entry:b', 'entry', '0.33'],
      ['entry:c', 'entry', '0.13'],
      ['entry:d', 'entry', '-0.13'],
    ])
    expect(result.total).toBe('-1.17')
  })

  it('caps and floors each level, and says so on its own line', () => {
    const result = account({
      groups: [
        group('root', { cap: '3.00' }),
        group('child', { parentGroupId: 'root', floor: '0.00', sortOrder: 1 }),
      ],
      items: [
        { id: 'big', worth: '5.00', scoreGroupId: 'root' },
        { id: 'minus', worth: '-2.00', scoreGroupId: 'child' },
      ],
      entries: [{ id: 'e1', itemId: 'big' }, { id: 'e2', itemId: 'minus' }],
    })
    expect(lines(result)).toEqual([
      ['entry:e1', 'entry', '5.00'],
      ['entry:e2', 'entry', '-2.00'],
      ['grp:child:floor', 'group-adjustment', '2.00'],
      ['grp:root:cap', 'group-adjustment', '-2.00'],
    ])
    expect(result.total).toBe('3.00')
    expect(
      result.groups.map((one) => [one.groupId, one.depth, one.itemsTotal, one.childrenTotal, one.raw, one.final]),
    ).toEqual([
      ['child', 1, '-2.00', '0.00', '-2.00', '0.00'],
      ['root', 0, '5.00', '0.00', '5.00', '3.00'],
    ])
  })

  it('breaks ties by filing order, deterministically', () => {
    const result = account({
      groups: [group('g')],
      items: [{ id: 'i', worth: '2.00', aggregator: { ref: 'max@1', config: {} } }],
      // the later filing is listed first: order comes from createdAt, not input
      entries: [{ id: 'late', itemId: 'i', createdAt: 9 }, { id: 'early', itemId: 'i', createdAt: 1 }],
    })
    expect(lines(result)).toEqual([
      ['entry:early', 'entry', '2.00'],
      ['entry:late', 'entry-not-counted', '0.00'],
    ])
  })

  it('gives rejected evidence a zero line, and draft or withdrawn work none', () => {
    const result = account({
      groups: [group('g')],
      items: [{ id: 'i', worth: '2.00' }],
      entries: [
        { id: 'ok', itemId: 'i' },
        { id: 'no', itemId: 'i', status: 'rejected', createdAt: 2 },
        { id: 'draft', itemId: 'i', status: 'draft', createdAt: 3 },
        { id: 'open', itemId: 'i', status: 'in_review', createdAt: 4 },
        { id: 'gone', itemId: 'i', status: 'voided', createdAt: 5 },
        { id: 'anon', itemId: 'i', status: 'rejected', revisionId: null, createdAt: 6 },
      ],
    })
    // refusals are printed as they are walked; the counted lines follow the
    // fold - this order is what a reader of the account sees today
    expect(lines(result)).toEqual([
      ['entry:no', 'excluded-evidence', '0.00'],
      ['entry:anon', 'excluded-evidence', '0.00'],
      ['entry:ok', 'entry', '2.00'],
    ])
    expect(result.total).toBe('2.00')
  })

  it('voids a question without erasing that work was filed, and skips drafts entirely', () => {
    const result = account({
      groups: [group('g')],
      items: [
        { id: 'void-with-work', worth: '2.00', status: 'voided' },
        { id: 'void-empty', worth: '2.00', status: 'voided', sortOrder: 1 },
        { id: 'draft', worth: '2.00', status: 'draft', sortOrder: 2 },
      ],
      entries: [
        { id: 'e1', itemId: 'void-with-work' },
        // a planted approved entry under a draft question: no line at all
        { id: 'e2', itemId: 'draft', createdAt: 2 },
      ],
    })
    expect(lines(result)).toEqual([['item:void-with-work:voided', 'item-voided', '0.00']])
    expect(result.total).toBe('0.00')
  })

  it('counts a derived question with no entries at all', () => {
    const result = account({
      groups: [group('g')],
      items: [{ id: 'base', worth: '1.00' }, { id: 'bonus', worth: '0.50', derived: true, sortOrder: 1 }],
      entries: [{ id: 'e1', itemId: 'base' }],
    })
    expect(lines(result)).toEqual([
      ['entry:e1', 'entry', '1.00'],
      ['derived:bonus', 'derived', '0.50'],
    ])
    expect(result.total).toBe('1.50')
  })

  it('keeps provenance on every line that has one', () => {
    const result = account({
      groups: [group('g')],
      items: [{ id: 'i', worth: '2.00' }, { id: 'd', worth: '1.00', derived: true, sortOrder: 1 }],
      entries: [{ id: 'e1', itemId: 'i' }, { id: 'no', itemId: 'i', status: 'rejected', createdAt: 2 }],
    })
    expect(result.lines.map((line) => [line.lineId, line.provenance])).toEqual([
      ['entry:no', { entryId: 'no', entryRevisionId: 'r-no' }],
      ['entry:e1', { entryId: 'e1', entryRevisionId: 'r-e1', calculatorRef: 'fixed@1' }],
      ['derived:d', { calculatorRef: 'fixed@1' }],
    ])
  })
})
