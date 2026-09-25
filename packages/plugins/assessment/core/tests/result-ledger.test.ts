import { describe, expect, it } from 'vitest'
import {
  buildLedger,
  type LedgerEntry,
  type LedgerItem,
  type LedgerItemView,
  type LedgerModel,
  type LedgerResult,
} from '../src/client/result/ledger.ts'

// The score ledger's rows, worked out from the three answers the page reads:
// the account, the paper, and the reader's claims. The drawing is the browser
// suite's; what is asserted here is that the rows say what the account says -
// every question in its place, every line joined to its claim, every limit
// that bit written where it bit - and that the figures still add up.

type Group = LedgerResult['groups'][number]
type Line = LedgerResult['lines'][number]

const group = (over: Partial<Group> & Pick<Group, 'groupId'>): Group => ({
  parentGroupId: null,
  depth: 0,
  name: over.groupId,
  itemsTotal: '0.00',
  childrenTotal: '0.00',
  raw: '0.00',
  final: '0.00',
  cap: null,
  floor: null,
  ...over,
})

const item = (over: Partial<LedgerItem> & Pick<LedgerItem, 'id' | 'scoreGroupId'>): LedgerItem => ({
  title: over.id,
  sortOrder: 0,
  status: 'active',
  itemType: 'evidence',
  currentRevision: {
    entryChannels: ['participant'],
    formConfig: {
      fields: [
        { id: 'name', key: 'name', type: 'text', label: 'Name' },
        { id: 'level', key: 'level', type: 'text', label: 'Level' },
      ],
    },
    displayConfig: null,
    scoringConfig: { calculator: { ref: 'fixed@1', config: { value: '6.0000' } } },
  },
  ...over,
})

const line = (over: Partial<Line> & Pick<Line, 'lineId' | 'kind'>): Line => ({
  label: 'label',
  value: '0.00',
  ...over,
})

/** a question that can only take away: a flat amount below zero */
const deduction = (id: string, scoreGroupId: string): LedgerItem =>
  item({
    id,
    scoreGroupId,
    currentRevision: {
      entryChannels: ['administrative'],
      scoringConfig: { calculator: { ref: 'fixed@1', config: { value: '-2' } } },
    },
  })

const claim = (over: LedgerEntry): LedgerEntry => over

const itemsOf = (model: LedgerModel): LedgerItemView[] =>
  model.sections.flatMap((section) =>
    section.rows.filter((row): row is LedgerItemView => row.kind === 'item'),
  )

describe('the score ledger model', () => {
  it('puts every published question in its place, scored or not', () => {
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '6.00',
        groups: [
          // the scorer answers children first
          group({
            groupId: 'inner',
            parentGroupId: 'outer',
            depth: 1,
            itemsTotal: '6.00',
            raw: '6.00',
            final: '6.00',
          }),
          group({ groupId: 'outer', childrenTotal: '6.00', raw: '6.00', final: '6.00' }),
        ],
        lines: [
          line({
            lineId: 'entry:e1',
            kind: 'entry',
            value: '6.00',
            itemId: 'q1',
            provenance: { entryId: 'e1' },
          }),
        ],
      },
      items: [
        item({ id: 'q2', scoreGroupId: 'inner', sortOrder: 2 }),
        item({ id: 'q1', scoreGroupId: 'inner', sortOrder: 1 }),
        // never published: never asked, so never listed
        item({ id: 'q3', scoreGroupId: 'inner', status: 'draft' }),
      ],
      entries: [
        claim({
          id: 'e1',
          itemId: 'q1',
          status: 'approved',
          source: 'self',
          currentRevision: {
            payload: { name: 'Robot contest', level: 'Provincial' },
            createdAt: '2026-03-01T00:00:00.000Z',
          },
          recognition: { createdAt: '2026-03-05T00:00:00.000Z' },
        }),
      ],
    })

    expect(model.sections.map((section) => section.group?.id)).toEqual(['outer'])
    const rows = model.sections[0]!.rows
    expect(
      rows.map((row) =>
        row.kind === 'item' ? row.id : row.kind === 'group' ? `group:${row.id}` : 'limit',
      ),
    ).toEqual(['group:inner', 'q1', 'q2'])
    expect(rows[0]).toMatchObject({ kind: 'group', no: '01.1', depth: 1 })
    const [scored, silent] = itemsOf(model)
    expect(scored).toMatchObject({ cents: 600, each: '6.0000', depth: 2 })
    expect(scored!.facts).toMatchObject({ approved: 1, recorded: 0 })
    // the line knows which claim it was, from the claim's own words
    expect(scored!.lines).toEqual([
      expect.objectContaining({
        entryId: 'e1',
        lead: 'Robot contest',
        sub: 'Provincial',
        at: '2026-03-05T00:00:00.000Z',
        recorded: false,
      }),
    ])
    expect(silent).toMatchObject({ cents: 0, lines: [] })
    // the rows add up to what the scorer printed
    expect(itemsOf(model).reduce((sum, one) => sum + one.cents, 0)).toBe(model.totalCents)
  })

  it('counts where each question’s claims stand, one word per claim', () => {
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '0.00',
        groups: [group({ groupId: 'g' })],
        lines: [
          line({
            lineId: 'x1',
            kind: 'excluded-evidence',
            itemId: 'q',
            provenance: { entryId: 'r1' },
          }),
          line({
            lineId: 'x2',
            kind: 'excluded-evidence',
            itemId: 'q',
            revoked: true,
            provenance: { entryId: 'r2' },
          }),
          line({
            lineId: 'x3',
            kind: 'entry-not-counted',
            itemId: 'q',
            provenance: { entryId: 'a1' },
          }),
          // given up by its owner after it was submitted: the scorer keeps it
          // on the account at zero with the same kind of line as a refusal
          line({
            lineId: 'x4',
            kind: 'excluded-evidence',
            itemId: 'q',
            provenance: { entryId: 'v1' },
          }),
          // a claim this reader was not handed: nothing to say why
          line({
            lineId: 'x5',
            kind: 'excluded-evidence',
            itemId: 'q',
            provenance: { entryId: 'u1' },
          }),
        ],
      },
      items: [item({ id: 'q', scoreGroupId: 'g' })],
      entries: [
        claim({ id: 'r1', itemId: 'q', status: 'rejected' }),
        claim({ id: 'r2', itemId: 'q', status: 'voided', source: 'record' }),
        claim({ id: 'p1', itemId: 'q', status: 'in_review' }),
        claim({ id: 'p2', itemId: 'q', status: 'in_review', supplement: { requestId: 's' } }),
        claim({ id: 'n1', itemId: 'q', status: 'needs_revision' }),
        claim({ id: 'd1', itemId: 'q', status: 'draft' }),
        claim({ id: 'a1', itemId: 'q', status: 'approved', openRound: { origin: 'appeal' } }),
        claim({ id: 'v1', itemId: 'q', status: 'voided' }),
        // given up before anybody saw it: the scorer writes no line for it
        claim({ id: 'v2', itemId: 'q', status: 'voided' }),
      ],
    })
    expect(itemsOf(model)[0]!.facts).toEqual({
      approved: 1,
      recorded: 0,
      notCounted: 1,
      reconsidering: 1,
      pending: 1,
      asked: 1,
      returned: 1,
      refused: 1,
      abandoned: 1,
      revoked: 1,
      excluded: 1,
      drafts: 1,
    })
    expect(itemsOf(model)[0]!.lines.map((one) => [one.standing, one.revoked])).toEqual([
      ['refused', false],
      ['revoked', true],
      ['notCounted', false],
      ['abandoned', false],
      ['excluded', false],
    ])
    // the head's counts: under review or looked at again, and unsent drafts
    expect(model.pending).toBe(3)
    expect(model.drafts).toBe(1)
    // off the account: two under review, one returned, one unsent; two of
    // them wait on the participant, so no single one is named
    expect(itemsOf(model)[0]).toMatchObject({ aside: 4, waitingOn: null })
  })

  it('names the one claim that waits on the participant, and counts what is off the account', () => {
    const build = (entries: LedgerEntry[]) =>
      itemsOf(
        buildLedger({
          result: {
            mode: 'provisional',
            total: '6.00',
            groups: [group({ groupId: 'g', final: '6.00', raw: '6.00', itemsTotal: '6.00' })],
            lines: [
              line({
                lineId: 'l',
                kind: 'entry',
                value: '6.00',
                itemId: 'q',
                provenance: { entryId: 'a' },
              }),
            ],
          },
          items: [item({ id: 'q', scoreGroupId: 'g' })],
          entries,
        }),
      )[0]!
    const approved = claim({ id: 'a', itemId: 'q', status: 'approved' })
    expect(build([approved])).toMatchObject({ aside: 0, waitingOn: null })
    expect(
      build([approved, claim({ id: 'n', itemId: 'q', status: 'needs_revision' })]),
    ).toMatchObject({ aside: 1, waitingOn: 'n' })
    // an ask for more material on a claim that is on the account waits on
    // the participant too, and is not off the account
    expect(
      build([
        { ...approved, supplement: { requestId: 's' } },
        claim({ itemId: 'q', status: 'draft' }),
      ]),
    ).toMatchObject({ aside: 1, waitingOn: 'a' })
  })

  it('writes a limit that bit under what it held down, and the figure it held it to', () => {
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '14.00',
        groups: [
          group({
            groupId: 'kid',
            parentGroupId: 'top',
            depth: 1,
            itemsTotal: '9.00',
            raw: '9.00',
            final: '4.00',
            cap: '4.00',
          }),
          group({
            groupId: 'top',
            itemsTotal: '12.00',
            childrenTotal: '4.00',
            raw: '16.00',
            final: '12.00',
            cap: '12.00',
          }),
          group({ groupId: 'floored', raw: '-3.00', final: '2.00', floor: '2.00' }),
        ],
        lines: [],
      },
      items: [item({ id: 'q', scoreGroupId: 'top' }), item({ id: 'k', scoreGroupId: 'kid' })],
      entries: [],
    })
    const [top, floored] = model.sections
    const kinds = top!.rows.map((row) =>
      row.kind === 'adjustment'
        ? `limit:${row.groupId}:${String(row.deltaCents)}`
        : row.kind === 'group'
          ? `group:${row.id}`
          : row.id,
    )
    // the child's own limit closes the child; the parent's closes the parent
    expect(kinds).toEqual(['q', 'group:kid', 'k', 'limit:kid:-500', 'limit:top:-400'])
    expect(top!.group).toMatchObject({ full: true, capCents: 1200, leftCents: null })
    expect(floored!.rows).toEqual([
      expect.objectContaining({
        kind: 'adjustment',
        rule: 'floor',
        rawCents: -300,
        limitCents: 200,
        deltaCents: 500,
      }),
    ])
    // what caps held back, and only caps
    expect(model.trimmedCents).toBe(900)
  })

  it('says a group has room left only once it has started and nothing in it is moving', () => {
    const build = (entries: LedgerEntry[]) =>
      buildLedger({
        result: {
          mode: 'provisional',
          total: '3.00',
          groups: [
            group({ groupId: 'g', itemsTotal: '3.00', raw: '3.00', final: '3.00', cap: '10.00' }),
          ],
          lines: [line({ lineId: 'l', kind: 'entry', value: '3.00', itemId: 'q' })],
        },
        items: [item({ id: 'q', scoreGroupId: 'g' })],
        entries,
      }).tops[0]!
    expect(build([])).toMatchObject({ leftCents: 700, pending: 0, full: false })
    expect(build([claim({ itemId: 'q', status: 'in_review' })])).toMatchObject({
      leftCents: null,
      pending: 1,
    })
  })

  it('leaves out groups that hold nothing, and numbers the rest without gaps', () => {
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '0.00',
        groups: [group({ groupId: 'a' }), group({ groupId: 'empty' }), group({ groupId: 'b' })],
        lines: [],
      },
      items: [item({ id: 'qa', scoreGroupId: 'a' }), item({ id: 'qb', scoreGroupId: 'b' })],
      entries: [],
    })
    expect(model.tops.map((top) => [top.id, top.no])).toEqual([
      ['a', '01'],
      ['b', '02'],
    ])
  })

  it('divides the total into a bar only where every top group has a limit and there are few enough', () => {
    const tops = (count: number, capped = true) =>
      buildLedger({
        result: {
          mode: 'provisional',
          total: String(count),
          groups: Array.from({ length: count }, (_, index) =>
            group({
              groupId: `g${String(index)}`,
              final: '1.00',
              raw: '1.00',
              cap: capped ? '5.00' : null,
            }),
          ),
          lines: [],
        },
        items: Array.from({ length: count }, (_, index) =>
          item({ id: `q${String(index)}`, scoreGroupId: `g${String(index)}` }),
        ),
        entries: [],
      })
    expect(tops(1).shares).toBeNull()
    expect(tops(2).shares?.map((share) => share.pct)).toEqual([10, 10])
    expect(tops(2).fullCents).toBe(1000)
    expect(tops(8).shares).toHaveLength(8)
    expect(tops(9).shares).toBeNull()
    expect(tops(3, false).shares).toBeNull()
    expect(tops(3, false).fullCents).toBeNull()

    // a group of deductions has no limit and needs none: it only takes away
    const deducting = buildLedger({
      result: {
        mode: 'provisional',
        total: '6.00',
        groups: [
          group({ groupId: 'a', final: '5.00', raw: '5.00', cap: '10.00' }),
          group({ groupId: 'b', final: '3.00', raw: '3.00', cap: '20.00' }),
          group({ groupId: 'minus', final: '-2.00', raw: '-2.00' }),
        ],
        lines: [],
      },
      items: [
        item({ id: 'q-a', scoreGroupId: 'a' }),
        item({ id: 'q-b', scoreGroupId: 'b' }),
        deduction('q-minus', 'minus'),
      ],
      entries: [],
    })
    expect(deducting.fullCents).toBe(3000)
    expect(deducting.shares?.map((share) => share.id)).toEqual(['a', 'b'])
  })

  it('reads the round’s full marks off how it is set up, not off how far anyone has got', () => {
    const full = (
      extra: { final: string; items: LedgerItem[]; groups?: Group[] },
      over: Partial<Group> = {},
    ) =>
      buildLedger({
        result: {
          mode: 'provisional',
          total: '5.00',
          groups: [
            group({ groupId: 'a', final: '5.00', raw: '5.00', cap: '10.00' }),
            group({ groupId: 'x', final: extra.final, raw: extra.final, ...over }),
            ...(extra.groups ?? []),
          ],
          lines: [],
        },
        items: [item({ id: 'q-a', scoreGroupId: 'a' }), ...extra.items],
        entries: [],
      }).fullCents

    // a group that adds and has no limit: no full mark before its first
    // point, and none after it - not one that comes and goes
    const adding = [item({ id: 'q-x', scoreGroupId: 'x' })]
    expect(full({ final: '0.00', items: adding })).toBeNull()
    expect(full({ final: '6.00', items: adding })).toBeNull()

    // deductions add nothing to the most anyone can reach, taken or not
    const taking = [
      deduction('q-x', 'x'),
      item({ id: 'q-gone', scoreGroupId: 'x', status: 'voided' }),
    ]
    expect(full({ final: '0.00', items: taking })).toBe(1000)
    expect(full({ final: '-2.00', items: taking })).toBe(1000)
    // a minimum is part of the most a group can come to
    expect(full({ final: '1.00', items: taking }, { floor: '1.00' })).toBe(1100)

    // a formula says nothing a reader can see about how much it may add
    const formula = item({
      id: 'q-x',
      scoreGroupId: 'x',
      currentRevision: {
        entryChannels: ['participant'],
        scoringConfig: { calculator: { ref: 'formula@1', config: { versionId: 'v' } } },
      },
    })
    expect(full({ final: '0.00', items: [formula] })).toBeNull()

    // no limit of its own, but every group inside it has one
    expect(
      full({
        final: '0.00',
        items: [item({ id: 'q-x1', scoreGroupId: 'x1' }), item({ id: 'q-x2', scoreGroupId: 'x2' })],
        groups: [
          group({ groupId: 'x1', parentGroupId: 'x', depth: 1, cap: '4.00' }),
          group({ groupId: 'x2', parentGroupId: 'x', depth: 1, cap: '6.00' }),
        ],
      }),
    ).toBe(2000)
  })

  it('keeps questions no group holds, and lines no question it was handed, on the account', () => {
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '5.00',
        groups: [
          group({ groupId: 'g', final: '2.00', raw: '2.00', itemsTotal: '2.00', cap: '4.00' }),
        ],
        lines: [
          line({ lineId: 'l1', kind: 'entry', value: '2.00', itemId: 'q' }),
          line({
            lineId: 'l2',
            kind: 'derived',
            value: '3.00',
            itemId: 'unknown',
            label: 'Frozen title',
          }),
        ],
      },
      items: [item({ id: 'q', scoreGroupId: 'g' }), item({ id: 'stray', scoreGroupId: 'gone' })],
      entries: [],
    })
    const loose = model.sections.at(-1)!
    expect(loose.group).toBeNull()
    expect(
      loose.rows.map((row) =>
        row.kind === 'item' ? [row.id, row.title, row.cents, row.derived] : null,
      ),
    ).toEqual([
      ['stray', 'stray', 0, false],
      ['unknown', 'Frozen title', 300, true],
    ])
    // with a question outside the groups there is no honest full mark
    expect(model.fullCents).toBeNull()
    expect(itemsOf(model).reduce((sum, one) => sum + one.cents, 0)).toBe(model.totalCents)
  })

  it('numbers and indents groups four deep the way a reader counts them', () => {
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '1.00',
        groups: [
          group({
            groupId: 'd',
            parentGroupId: 'c',
            depth: 3,
            final: '1.00',
            raw: '1.00',
            itemsTotal: '1.00',
          }),
          group({
            groupId: 'c',
            parentGroupId: 'b',
            depth: 2,
            final: '1.00',
            raw: '1.00',
            childrenTotal: '1.00',
          }),
          group({ groupId: 'c2', parentGroupId: 'b', depth: 2 }),
          group({
            groupId: 'b',
            parentGroupId: 'a',
            depth: 1,
            final: '1.00',
            raw: '1.00',
            childrenTotal: '1.00',
          }),
          group({ groupId: 'a', final: '1.00', raw: '1.00', childrenTotal: '1.00' }),
        ],
        lines: [line({ lineId: 'l', kind: 'entry', value: '1.00', itemId: 'q' })],
      },
      items: [item({ id: 'q', scoreGroupId: 'd' }), item({ id: 'q2', scoreGroupId: 'c2' })],
      entries: [],
    })
    expect(
      model.sections[0]!.rows.map((row) =>
        row.kind === 'group'
          ? [row.no, row.depth]
          : row.kind === 'item'
            ? [row.id, row.depth]
            : null,
      ),
    ).toEqual([
      ['01.1', 1],
      ['01.1.1', 2],
      ['01.1.1.1', 3],
      ['q', 4],
      ['01.1.2', 2],
      ['q2', 3],
    ])
  })

  it('reads a round that asks nothing as empty', () => {
    const model = buildLedger({
      result: { mode: 'provisional', total: '0.00', groups: [], lines: [] },
      items: [],
      entries: [],
    })
    expect(model.empty).toBe(true)
    expect(model.sections).toEqual([])
  })

  it('tells the office’s records from filed claims, and a withdrawn question from a live one', () => {
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '9.50',
        groups: [group({ groupId: 'g', final: '9.50', raw: '9.50', itemsTotal: '9.50' })],
        lines: [
          line({
            lineId: 'r',
            kind: 'entry',
            value: '9.50',
            itemId: 'rec',
            provenance: { entryId: 'r1' },
          }),
          line({ lineId: 'v', kind: 'item-voided', value: '0.00', itemId: 'old' }),
        ],
      },
      items: [
        item({
          id: 'rec',
          scoreGroupId: 'g',
          currentRevision: { entryChannels: ['administrative'], scoringConfig: null },
        }),
        item({ id: 'old', scoreGroupId: 'g', status: 'voided' }),
        item({
          id: 'const',
          scoreGroupId: 'g',
          itemType: 'constant',
          currentRevision: {
            entryChannels: [],
            scoringConfig: { calculator: { ref: 'fixed@1', config: { value: '2' } } },
          },
        }),
      ],
      entries: [claim({ id: 'r1', itemId: 'rec', status: 'approved', source: 'record' })],
    })
    const [recorded, withdrawn, constant] = itemsOf(model)
    expect(recorded).toMatchObject({ recordedOnly: true, each: null })
    expect(recorded!.facts).toMatchObject({ approved: 0, recorded: 1 })
    expect(recorded!.lines[0]).toMatchObject({ recorded: true })
    expect(withdrawn).toMatchObject({ voided: true, cents: 0 })
    expect(constant).toMatchObject({ perPerson: '2', each: null })
  })
})
