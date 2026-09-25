import { describe, expect, it } from 'vitest'
import type { EntryDto, ItemDto } from '../src/client/entry/model.ts'
import type { Standing, StructureRow } from '../src/client/entry/standing.ts'
import {
  chipsFor,
  entryLineOf,
  headStatsOf,
  outlineOf,
  totalsOf,
  type Viewer,
} from '../src/client/entry/workspace/model.ts'

// What the entries workspace says, worked out before anything is drawn: the
// head's figures against the filters under them, full marks, and how a
// claim's identity line is joined. Pure functions, run here because what
// they read belongs to the browser program; the drawing is the workspace
// suite's.

const claim = (id: string, over: Partial<EntryDto> = {}): EntryDto =>
  ({
    id,
    itemId: 'q1',
    status: 'in_review',
    source: 'self',
    supplement: null,
    refusal: null,
    openRound: null,
    recognition: null,
    currentRevision: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    ...over,
  }) as unknown as EntryDto

describe('the head of the structure against the filters under it', () => {
  const asked = {
    requestId: 'a',
    instanceId: 'i',
    requestNo: 1,
    instructions: 'more',
    requirements: [],
    requestedByName: null,
    requestedAt: '2026-04-02T00:00:00.000Z',
  }
  const claims = [
    claim('e1'),
    claim('e2', { status: 'rejected', openRound: { origin: 'appeal' } }),
    claim('e3', { status: 'approved', openRound: { origin: 'reopen' } }),
    claim('e4', { status: 'approved' }),
    claim('e5', { status: 'rejected' }),
    claim('e6', { status: 'needs_revision' }),
    claim('e7', { supplement: asked }),
  ]
  const counts = (viewer: Viewer) =>
    new Map(chipsFor(viewer).map((chip) => [chip.key, claims.filter(chip.test).length] as const))
  const stats = (viewer: Viewer) =>
    new Map(headStatsOf(viewer, claims).map((stat) => [stat.key, stat.count] as const))

  it('counts a claim under appeal or re-examination as in review for its owner', () => {
    // the one in review, the two out with the reviewers again, and the one
    // a reviewer asked more of, which the owner's filter keeps as a to-do
    expect(stats('owner').get('in_review')).toBe(4)
    expect(counts('owner').get('in_review')).toBe(3)
  })

  it('gives a staff reader every head figure as a filter of the same count', () => {
    const head = stats('staff')
    const filters = counts('staff')
    for (const key of ['approved', 'in_review', 'contested', 'rejected'] as const) {
      expect({ key, count: filters.get(key) }).toEqual({ key, count: head.get(key) })
    }
    expect(head.get('contested')).toBe(2)
    expect(filters.get('waiting')).toBe(head.get('supplement')! + head.get('needs_revision')!)
  })
})

const row = (over: Partial<StructureRow> & Pick<StructureRow, 'id'>): StructureRow => ({
  kind: 'group',
  depth: 0,
  name: over.id,
  right: '',
  tag: null,
  todo: false,
  unread: false,
  trail: [],
  parentId: null,
  cap: null,
  ...over,
})

describe('full marks at the head', () => {
  const standing = { total: '4.00', groups: [], lines: [] } satisfies Standing

  it('adds up the limited top sections, and leaves one without a limit out', () => {
    const outline = outlineOf([
      row({ id: 'study', cap: '10.00' }),
      row({ id: 'conduct', cap: '25.00' }),
      row({ id: 'deductions', cap: null }),
    ])
    expect(totalsOf(outline, standing)).toEqual({ got: '4.00', cap: 35 })
  })

  it('has none where no top section sets a limit', () => {
    const outline = outlineOf([row({ id: 'a' }), row({ id: 'b' })])
    expect(totalsOf(outline, standing).cap).toBeNull()
  })

  it('takes a single root’s own limit, and its sections’ where it sets none', () => {
    const under = (cap: string | null) => [
      row({ id: 'root', cap, right: '4.00' }),
      row({ id: 'study', depth: 1, parentId: 'root', cap: '10.00' }),
      row({ id: 'deductions', depth: 1, parentId: 'root', cap: null }),
    ]
    expect(totalsOf(outlineOf(under('100.00')), standing).cap).toBe(100)
    expect(totalsOf(outlineOf(under(null)), standing).cap).toBe(10)
  })
})

describe('a claim’s identity line', () => {
  const item = {
    id: 'q1',
    title: 'Scholarship',
    status: 'active',
    itemType: 'evidence',
    maxEntries: null,
    currentRevision: {
      entryChannels: ['participant'],
      formConfig: {
        fields: [
          { id: 'name', key: 'name', type: 'text', label: 'Name' },
          { id: 'level', key: 'level', type: 'text', label: 'Level' },
          { id: 'gpa', key: 'gpa', type: 'decimal', label: 'GPA' },
        ],
      },
      displayConfig: null,
      scoringConfig: null,
    },
  } as unknown as ItemDto

  it('joins its parts in the words it is handed, never in a language of its own', () => {
    const line = entryLineOf(
      claim('e1', {
        status: 'draft',
        currentRevision: {
          payload: { name: 'National', level: 'First', gpa: '3.9' },
          createdAt: '2026-04-01T00:00:00.000Z',
        },
      } as Partial<EntryDto>),
      item,
      null,
      {
        figure: (label, value) => `${label}=${value}`,
        join: (before, after) => `${before}|${after}`,
      },
    )
    expect(line.lead).toBe('National')
    expect(line.sub).toBe('First|GPA=3.9')
  })
})
