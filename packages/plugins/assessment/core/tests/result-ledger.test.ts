import { describe, expect, it } from 'vitest'
import {
  buildLedger,
  filingShutOf,
  trailOf,
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

    // the one root is the paper, lifted away: the group inside it is the top
    expect(model.sections.map((section) => [section.kind, section.group?.id])).toEqual([
      ['group', 'inner'],
    ])
    expect(model.tops).toEqual([expect.objectContaining({ id: 'inner', no: '01', depth: 0 })])
    const rows = model.sections[0]!.rows
    expect(
      rows.map((row) =>
        row.kind === 'item' ? row.id : row.kind === 'group' ? `group:${row.id}` : 'limit',
      ),
    ).toEqual(['q1', 'q2'])
    const [scored, silent] = itemsOf(model)
    expect(scored).toMatchObject({ cents: 600, each: '6.0000', depth: 1 })
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

  it('sets nothing aside on a withdrawn question, and nothing decided on a live one', () => {
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '6.00',
        groups: [group({ groupId: 'g', final: '6.00', raw: '6.00', itemsTotal: '6.00' })],
        lines: [
          line({ lineId: 'v', kind: 'item-voided', value: '0.00', itemId: 'old' }),
          line({
            lineId: 'l',
            kind: 'entry',
            value: '6.00',
            itemId: 'live',
            provenance: { entryId: 'counted' },
          }),
        ],
      },
      items: [
        item({ id: 'old', scoreGroupId: 'g', status: 'voided' }),
        item({ id: 'live', scoreGroupId: 'g' }),
      ],
      entries: [
        // decided before the question was withdrawn: kept as they were, and
        // the question's own line stands for them on the account
        claim({ id: 'kept-a', itemId: 'old', status: 'approved' }),
        claim({ id: 'kept-r', itemId: 'old', status: 'rejected' }),
        claim({ id: 'kept-n', itemId: 'old', status: 'needs_revision' }),
        claim({ id: 'counted', itemId: 'live', status: 'approved' }),
        // decided, and not on the account for a reason this reader cannot
        // see: nothing about it is still to come
        claim({ id: 'elsewhere', itemId: 'live', status: 'rejected' }),
      ],
    })
    const [old, live] = itemsOf(model)
    expect(old).toMatchObject({ voided: true, aside: 0, waitingOn: null })
    expect(old!.lines.map((one) => one.kind)).toEqual(['item-voided'])
    expect(live).toMatchObject({ voided: false, aside: 0 })
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
            group({
              groupId: 'g',
              parentGroupId: 'paper',
              depth: 1,
              itemsTotal: '3.00',
              raw: '3.00',
              final: '3.00',
              cap: '10.00',
            }),
            group({ groupId: 'paper', childrenTotal: '3.00', raw: '3.00', final: '3.00' }),
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
          group({ groupId: 'paper', final: '1.00', raw: '1.00', childrenTotal: '1.00' }),
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
          group({
            groupId: 'a',
            parentGroupId: 'paper',
            final: '1.00',
            raw: '1.00',
            childrenTotal: '1.00',
          }),
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

  it('lifts the paper away and numbers the parts inside it as the tops (§32.61)', () => {
    // the demo batches' paper (tools/demo/rules.ts): full marks 100, three
    // parts, two of them with groups of their own
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '80.00',
        groups: [
          group({
            groupId: 'honour',
            parentGroupId: 'moral',
            depth: 2,
            itemsTotal: '3.00',
            raw: '3.00',
            final: '3.00',
            cap: '3.00',
          }),
          group({ groupId: 'practice', parentGroupId: 'moral', depth: 2, cap: '1.00' }),
          group({
            groupId: 'moral',
            parentGroupId: 'paper',
            depth: 1,
            itemsTotal: '8.00',
            childrenTotal: '3.00',
            raw: '11.00',
            final: '11.00',
            cap: '15.00',
            floor: '0.00',
          }),
          group({
            groupId: 'academic',
            parentGroupId: 'paper',
            depth: 1,
            itemsTotal: '60.00',
            raw: '60.00',
            final: '60.00',
            cap: '75.00',
            floor: '0.00',
          }),
          group({ groupId: 'cadre', parentGroupId: 'sports', depth: 2, cap: '3.00' }),
          group({
            groupId: 'activity',
            parentGroupId: 'sports',
            depth: 2,
            itemsTotal: '6.00',
            raw: '6.00',
            final: '4.00',
            cap: '4.00',
          }),
          group({
            groupId: 'sports',
            parentGroupId: 'paper',
            depth: 1,
            itemsTotal: '5.00',
            childrenTotal: '4.00',
            raw: '9.00',
            final: '9.00',
            cap: '10.00',
            floor: '0.00',
          }),
          group({
            groupId: 'paper',
            name: '综合素质测评',
            childrenTotal: '80.00',
            raw: '80.00',
            final: '80.00',
            cap: '100.00',
            floor: '0.00',
          }),
        ],
        lines: [
          line({ lineId: 'a', kind: 'entry', value: '8.00', itemId: 'moral-base' }),
          line({ lineId: 'b', kind: 'entry', value: '3.00', itemId: 'honour-q' }),
          line({ lineId: 'c', kind: 'entry', value: '60.00', itemId: 'academic-base' }),
          line({ lineId: 'd', kind: 'entry', value: '5.00', itemId: 'sports-base' }),
          line({ lineId: 'e', kind: 'entry', value: '6.00', itemId: 'activity-q' }),
        ],
      },
      items: [
        item({ id: 'moral-base', scoreGroupId: 'moral', sortOrder: 1 }),
        item({ id: 'honour-q', scoreGroupId: 'honour' }),
        item({ id: 'practice-q', scoreGroupId: 'practice' }),
        item({ id: 'academic-base', scoreGroupId: 'academic' }),
        item({ id: 'sports-base', scoreGroupId: 'sports' }),
        item({ id: 'cadre-q', scoreGroupId: 'cadre' }),
        item({ id: 'activity-q', scoreGroupId: 'activity' }),
      ],
      entries: [],
    })

    expect(model.sections.map((section) => [section.kind, section.key])).toEqual([
      ['group', 'moral'],
      ['group', 'academic'],
      ['group', 'sports'],
    ])
    expect(model.tops.map((top) => [top.id, top.no, top.depth, top.capCents])).toEqual([
      ['moral', '01', 0, 1500],
      ['academic', '02', 0, 7500],
      ['sports', '03', 0, 1000],
    ])
    expect(
      model.sections[0]!.rows.map((row) =>
        row.kind === 'group' ? [row.no, row.depth] : row.kind === 'item' ? [row.id, row.depth] : [],
      ),
    ).toEqual([
      ['moral-base', 1],
      ['01.1', 1],
      ['honour-q', 2],
      ['01.2', 1],
      ['practice-q', 2],
    ])
    // the paper's limit is the round's full mark, and the parts divide it
    expect(model.fullCents).toBe(10000)
    expect(model.shares?.map((share) => [share.id, share.pct])).toEqual([
      ['moral', 11],
      ['academic', 60],
      ['sports', 9],
    ])
    // it did not bite, so it writes no line
    expect(model.limit).toBeNull()
    // the rows and the limits inside the paper add up to what the scorer printed
    const limits = model.sections.flatMap((section) =>
      section.rows.flatMap((row) => (row.kind === 'adjustment' ? [row.deltaCents] : [])),
    )
    expect(limits).toEqual([-200])
    expect(
      itemsOf(model).reduce((sum, one) => sum + one.cents, 0) +
        limits.reduce((sum, one) => sum + one, 0),
    ).toBe(model.totalCents)
  })

  it('stands the paper’s own questions first with no group over them, and its limit last', () => {
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '100.00',
        groups: [
          group({
            groupId: 'a',
            parentGroupId: 'paper',
            depth: 1,
            itemsTotal: '60.00',
            raw: '60.00',
            final: '60.00',
            cap: '60.00',
          }),
          group({
            groupId: 'b',
            parentGroupId: 'paper',
            depth: 1,
            itemsTotal: '15.00',
            raw: '15.00',
            final: '15.00',
            cap: '40.00',
          }),
          group({
            groupId: 'paper',
            itemsTotal: '30.00',
            childrenTotal: '75.00',
            raw: '105.00',
            final: '100.00',
            cap: '100.00',
          }),
        ],
        lines: [
          line({ lineId: 'own', kind: 'entry', value: '30.00', itemId: 'own-q' }),
          line({ lineId: 'a', kind: 'entry', value: '60.00', itemId: 'a-q' }),
          line({ lineId: 'b', kind: 'entry', value: '15.00', itemId: 'b-q' }),
        ],
      },
      items: [
        item({ id: 'a-q', scoreGroupId: 'a' }),
        item({ id: 'own-q', scoreGroupId: 'paper' }),
        item({ id: 'b-q', scoreGroupId: 'b' }),
      ],
      entries: [],
    })
    expect(model.sections.map((section) => [section.kind, section.key, section.group])).toEqual([
      ['paper', 'paper', null],
      ['group', 'a', expect.objectContaining({ no: '01' })],
      ['group', 'b', expect.objectContaining({ no: '02' })],
    ])
    expect(model.sections[0]!.rows).toEqual([
      expect.objectContaining({ kind: 'item', id: 'own-q', depth: 0, cents: 3000 }),
    ])
    // the paper held the round to its full mark: one line, at the end
    expect(model.limit).toMatchObject({
      groupId: 'paper',
      rule: 'cap',
      depth: 0,
      rawCents: 10500,
      limitCents: 10000,
      deltaCents: -500,
    })
    expect(model.trimmedCents).toBe(500)
    expect(model.fullCents).toBe(10000)
    // a question of the paper's own that adds is a part of the total no
    // bar of the groups could show
    expect(model.shares).toBeNull()
    expect(itemsOf(model).reduce((sum, one) => sum + one.cents, 0) + model.limit!.deltaCents).toBe(
      model.totalCents,
    )
  })

  it('draws the bar against what the groups came to where the paper held them back', () => {
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '100.00',
        groups: [
          group({
            groupId: 'a',
            parentGroupId: 'paper',
            raw: '70.00',
            final: '70.00',
            cap: '70.00',
          }),
          group({
            groupId: 'b',
            parentGroupId: 'paper',
            raw: '40.00',
            final: '40.00',
            cap: '40.00',
          }),
          group({ groupId: 'paper', raw: '108.00', final: '100.00', cap: '100.00' }),
        ],
        lines: [],
      },
      items: [
        item({ id: 'a-q', scoreGroupId: 'a' }),
        item({ id: 'b-q', scoreGroupId: 'b' }),
        // a deduction the paper holds itself takes away and adds nothing
        deduction('minus', 'paper'),
      ],
      entries: [],
    })
    expect(model.sections.map((section) => section.kind)).toEqual(['paper', 'group', 'group'])
    const pcts = model.shares!.map((share) => share.pct)
    expect(pcts[0]).toBeCloseTo((70 / 110) * 100)
    expect(pcts.reduce((sum, one) => sum + one, 0)).toBeCloseTo(100)
  })

  it('reads a paper with one group, or none, and a paper with no full mark set', () => {
    const paperOf = (over: {
      cap: string | null
      groups?: Group[]
      items: LedgerItem[]
    }): LedgerModel =>
      buildLedger({
        result: {
          mode: 'provisional',
          total: '0.00',
          groups: [...(over.groups ?? []), group({ groupId: 'paper', cap: over.cap })],
          lines: [],
        },
        items: over.items,
        entries: [],
      })

    // one group inside the paper: a band of its own, nothing to move between
    const single = paperOf({
      cap: '100.00',
      groups: [group({ groupId: 'only', parentGroupId: 'paper', cap: '100.00' })],
      items: [item({ id: 'q', scoreGroupId: 'only' })],
    })
    expect(single.sections.map((section) => section.kind)).toEqual(['group'])
    expect(single.tops).toHaveLength(1)
    expect(single.shares).toBeNull()
    expect(single.fullCents).toBe(10000)

    // no group at all: the questions are the paper's own, with no band
    const flat = paperOf({
      cap: '20.00',
      items: [item({ id: 'q1', scoreGroupId: 'paper' }), item({ id: 'q2', scoreGroupId: 'paper' })],
    })
    expect(flat.sections.map((section) => [section.kind, section.rows.length])).toEqual([
      ['paper', 2],
    ])
    expect(flat.tops).toEqual([])
    expect(flat.fullCents).toBe(2000)

    // full marks not set yet: the parts say them, if they all have limits
    const parts = [
      group({ groupId: 'x', parentGroupId: 'paper', cap: '15.00' }),
      group({ groupId: 'y', parentGroupId: 'paper', cap: '85.00' }),
    ]
    const partsItems = [
      item({ id: 'qx', scoreGroupId: 'x' }),
      item({ id: 'qy', scoreGroupId: 'y' }),
    ]
    expect(paperOf({ cap: null, groups: parts, items: partsItems }).fullCents).toBe(10000)
    // and a question of the paper's own that may add leaves them unsaid
    expect(
      paperOf({
        cap: null,
        groups: parts,
        items: [...partsItems, item({ id: 'own', scoreGroupId: 'paper' })],
      }).fullCents,
    ).toBeNull()
    // a paper nothing can add to has no full mark to print, not a zero
    expect(paperOf({ cap: null, items: [deduction('minus', 'paper')] }).fullCents).toBeNull()
  })

  it('keeps the paper lifted when a line names a question this reader was not handed', () => {
    const build = (cap: string | null) =>
      buildLedger({
        result: {
          mode: 'provisional',
          total: '3.00',
          groups: [
            group({ groupId: 'a', parentGroupId: 'paper', cap: '10.00' }),
            group({ groupId: 'b', parentGroupId: 'paper', cap: '10.00' }),
            group({ groupId: 'paper', raw: '3.00', final: '3.00', cap }),
          ],
          lines: [line({ lineId: 's', kind: 'derived', value: '3.00', itemId: 'stranger' })],
        },
        items: [item({ id: 'qa', scoreGroupId: 'a' }), item({ id: 'qb', scoreGroupId: 'b' })],
        entries: [],
      })
    const capped = build('100.00')
    expect(capped.sections.map((section) => [section.kind, section.key])).toEqual([
      ['group', 'a'],
      ['group', 'b'],
      ['loose', 'ungrouped'],
    ])
    // the paper's limit holds whatever is on it, known here or not
    expect(capped.fullCents).toBe(10000)
    // without one, a question nobody here can read may add anything
    expect(build(null).fullCents).toBeNull()
  })

  it('tells which questions the stages keep shut, and whether filing is behind or ahead', () => {
    const gates = [
      { itemId: 'none-yet', create: { state: 'blocked', reason: 'no-active-phase' } },
      { itemId: 'not-now', create: { state: 'blocked', reason: 'phase-closed' } },
      { itemId: 'other-items', create: { state: 'blocked', reason: 'item-out-of-scope' } },
      // shut by something other than the stages, or not shut at all
      { itemId: 'full', create: { state: 'blocked', reason: 'max-entries-reached' } },
      { itemId: 'open', create: { state: 'available', reason: null } },
      { itemId: 'hidden', create: { state: 'hidden', reason: null } },
    ]
    const at = (...statuses: string[]) => statuses.map((status) => ({ status }))
    const shut = (stages: { status: string }[] | undefined) =>
      Object.fromEntries(filingShutOf(gates, stages))
    const three = (why: string) => ({ 'none-yet': why, 'not-now': why, 'other-items': why })
    expect(shut(at('future', 'future'))).toEqual(three('before'))
    // nothing arranged at all has not begun either
    expect(shut(at())).toEqual(three('before'))
    expect(shut(at('ended', 'current'))).toEqual(three('after'))
    expect(shut(at('ended', 'ended'))).toEqual(three('after'))
    expect(shut(at('ended', 'current', 'future'))).toEqual(three('between'))
    // without the timetable, no more than the moment is said
    expect(shut(undefined)).toEqual(three('between'))
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

  it('lists the claims off the account, what waits on the participant first, with what each would come to', () => {
    const model = buildLedger({
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
            provenance: { entryId: 'counted' },
          }),
        ],
      },
      items: [item({ id: 'q', scoreGroupId: 'g' })],
      entries: [
        claim({ id: 'counted', itemId: 'q', status: 'approved' }),
        claim({ id: 'kept', itemId: 'q', status: 'draft' }),
        claim({ id: 'sent', itemId: 'q', status: 'in_review' }),
        claim({ id: 'back', itemId: 'q', status: 'needs_revision' }),
        claim({ id: 'asked', itemId: 'q', status: 'in_review', supplement: { requestId: 's' } }),
        // given up: nothing about it is still to come
        claim({ id: 'gone', itemId: 'q', status: 'voided' }),
      ],
    })
    const [view] = itemsOf(model)
    expect(view!.open.map((one) => one.entryId)).toEqual(['back', 'asked', 'sent', 'kept'])
    expect(view!.open.every((one) => one.kind === 'claim' && one.standing === 'open')).toBe(true)
    // off the account they count for nothing yet, and say what they would
    expect(view!.open.map((one) => [one.cents, one.wouldCents])).toEqual([
      [0, 600],
      [0, 600],
      [0, 600],
      [0, 600],
    ])
    expect(view!.lines.map((one) => one.wouldCents)).toEqual([null])
    // the rows still add up to the figure
    expect(view!.cents).toBe(600)
  })

  it('says what last happened to each claim, with a reviewer’s words and its files', () => {
    const payload = (name: string, files: number) => ({
      payload: {
        name,
        proof: Array.from({ length: files }, (_, index) => `file-${String(index)}`),
      },
      createdAt: '2026-03-02T00:00:00.000Z',
    })
    const model = buildLedger({
      result: {
        mode: 'provisional',
        total: '0.00',
        groups: [group({ groupId: 'g' })],
        lines: [
          line({
            lineId: 'r',
            kind: 'excluded-evidence',
            value: '0.00',
            itemId: 'q',
            provenance: { entryId: 'refused' },
          }),
          line({
            lineId: 'o',
            kind: 'entry',
            value: '0.00',
            itemId: 'q',
            provenance: { entryId: 'office' },
          }),
        ],
      },
      items: [
        item({
          id: 'q',
          scoreGroupId: 'g',
          currentRevision: {
            entryChannels: ['participant', 'administrative'],
            formConfig: {
              fields: [
                { id: 'name', key: 'name', type: 'text', label: 'Name' },
                { id: 'proof', key: 'proof', type: 'attachment', label: 'Proof' },
              ],
            },
            scoringConfig: { calculator: { ref: 'fixed@1', config: { value: '0' } } },
          },
        }),
      ],
      entries: [
        claim({
          id: 'refused',
          itemId: 'q',
          status: 'rejected',
          currentRevision: payload('Robot contest', 2),
          refusal: { at: '2026-03-06T00:00:00.000Z', comment: ' Certificate unreadable ' },
        }),
        claim({
          id: 'back',
          itemId: 'q',
          status: 'needs_revision',
          currentRevision: payload('Essay prize', 1),
          refusal: { at: '2026-03-07T00:00:00.000Z', comment: null, reason: 'Missing proof' },
        }),
        claim({
          id: 'asked',
          itemId: 'q',
          status: 'in_review',
          currentRevision: payload('Volunteering', 0),
          supplement: { requestedAt: '2026-03-08T00:00:00.000Z', instructions: 'Add the stamp' },
        }),
        claim({
          id: 'office',
          itemId: 'q',
          status: 'approved',
          source: 'record',
          recognition: { createdAt: '2026-03-09T00:00:00.000Z' },
          currentRevision: payload('Course score', 0),
        }),
      ],
    })
    const [view] = itemsOf(model)
    const byEntry = new Map(
      [...view!.open, ...view!.lines].map((one) => [one.entryId, one.claim] as const),
    )
    expect(byEntry.get('refused')).toMatchObject({
      act: 'refused',
      actAt: '2026-03-06T00:00:00.000Z',
      note: { kind: 'refusal', text: 'Certificate unreadable' },
      files: 2,
    })
    expect(byEntry.get('back')).toMatchObject({
      act: 'returned',
      actAt: '2026-03-07T00:00:00.000Z',
      note: { kind: 'return', text: 'Missing proof' },
      files: 1,
    })
    // an ask outranks the claim's own state
    expect(byEntry.get('asked')).toMatchObject({
      act: 'asked',
      asked: true,
      actAt: '2026-03-08T00:00:00.000Z',
      note: { kind: 'ask', text: 'Add the stamp' },
      files: 0,
    })
    // the office recorded it; nobody approved it
    expect(byEntry.get('office')).toMatchObject({
      act: 'recorded',
      actAt: '2026-03-09T00:00:00.000Z',
      note: null,
    })
  })

  it('heads a claim with the groups above its question, the paper lifted away', () => {
    const groups = [
      group({ groupId: 'inner', parentGroupId: 'outer', name: 'Competitions' }),
      group({ groupId: 'outer', parentGroupId: 'paper', name: 'Academics' }),
      group({ groupId: 'paper', name: 'Assessment' }),
    ]
    expect(trailOf(groups, 'inner')).toEqual(['Academics', 'Competitions'])
    expect(trailOf(groups, 'paper')).toEqual([])
    // several roots: none of them is the paper, so every name stays
    expect(trailOf([...groups, group({ groupId: 'other', name: 'Other' })], 'inner')).toEqual([
      'Assessment',
      'Academics',
      'Competitions',
    ])
    expect(trailOf(groups, 'missing')).toEqual([])
  })
})
