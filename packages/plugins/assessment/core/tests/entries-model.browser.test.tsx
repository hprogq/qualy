import { describe, expect, it } from 'vitest'
import { claimActOf, claimFilesOf, claimNoteOf } from '../src/client/entry/claim-facts.ts'
import type { EntryDto, ItemDto } from '../src/client/entry/model.ts'
import { assessmentMessages as m } from '../src/client/i18n.ts'
import type { Standing, StructureRow } from '../src/client/entry/standing.ts'
import {
  chipsFor,
  dotOf,
  entryLineOf,
  filingHeldOf,
  headStatsOf,
  moveBetween,
  outlineOf,
  totalsOf,
  type RoundState,
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
    new Map(
      chipsFor(viewer, { status: 'active' }).map(
        (chip) => [chip.key, claims.filter(chip.test).length] as const,
      ),
    )
  const stats = (viewer: Viewer) =>
    new Map(headStatsOf(viewer, claims).map((stat) => [stat.key, stat.count] as const))

  it('counts a claim under appeal or re-examination as in review for its owner', () => {
    // the one in review, the two out with the reviewers again, and the one
    // a reviewer asked more of - under the same filter as at the head
    expect(stats('owner').get('in_review')).toBe(4)
    expect(counts('owner').get('in_review')).toBe(stats('owner').get('in_review'))
    // which is also the owner's own to-do: the owner's filters may overlap
    expect(
      chipsFor('owner', { status: 'active' })
        .filter((chip) => chip.test(claims[6]!))
        .map((chip) => chip.key),
    ).toEqual(['all', 'todo', 'in_review'])
  })

  // Ended without counting, each under the word for how it ended - and the
  // owner has them too, since news on one is read by opening it there.
  it('files a claim that ended under how it ended, for the owner as for staff', () => {
    const givenUp = claim('x1', { status: 'voided' })
    const revoked = claim('x2', { status: 'voided', source: 'record' })
    const keys = (viewer: Viewer, item: { status: 'active' | 'voided' }, one: EntryDto) =>
      chipsFor(viewer, item)
        .filter((chip) => chip.test(one))
        .map((chip) => chip.key)
    for (const viewer of ['owner', 'staff'] as const) {
      expect(keys(viewer, { status: 'active' }, givenUp)).toEqual(['abandoned'])
      expect(keys(viewer, { status: 'voided' }, givenUp)).toEqual(['voided'])
      expect(keys(viewer, { status: 'voided' }, revoked)).toEqual(['revoked'])
    }
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
  unread: 0,
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

  // The filing page and the account list the same claim; what last happened
  // to it, the reviewer's words on it and its files are one reading, and a
  // claim its owner gave up is said to have been given up in both.
  it('reads what last happened, the words on it and its files the way the account does', () => {
    const words = {
      figure: (label: string, value: string) => `${label} ${value}`,
      join: (a: string, b: string) => `${a} ${b}`,
    }
    const withFile = {
      ...item,
      currentRevision: {
        ...item.currentRevision!,
        formConfig: { fields: [{ id: 'proof', key: 'proof', type: 'attachment', label: 'Proof' }] },
      },
    } as ItemDto
    const filed = {
      payload: { proof: ['f1', 'f2'] },
      createdAt: '2026-04-03T00:00:00.000Z',
    } as unknown as EntryDto['currentRevision']
    const ask = (instructions: string) => ({
      requestId: 'a',
      instanceId: 'i',
      requestNo: 1,
      instructions,
      requirements: [],
      requestedByName: null,
      requestedAt: '2026-04-05T00:00:00.000Z',
    })
    const claims = [
      claim('given-up', { status: 'voided', currentRevision: filed }),
      claim('revoked', { status: 'voided', source: 'record' }),
      claim('asked', {
        supplement: ask('  a stamped copy  '),
        currentRevision: filed,
      }),
      claim('blank-ask', { supplement: ask('   ') }),
      claim('returned', {
        status: 'needs_revision',
        refusal: { at: '2026-04-04T00:00:00.000Z', comment: null, reason: 'late' },
      } as Partial<EntryDto>),
    ]
    for (const one of claims) {
      const line = entryLineOf(one, withFile, null, words)
      const { act, at } = claimActOf(one)
      expect({ act: line.act, at: line.at }, one.id).toEqual({ act, at: at ?? one.createdAt })
      expect(line.note, one.id).toEqual(claimNoteOf(one))
      expect(line.files, one.id).toBe(claimFilesOf(one, withFile.currentRevision?.formConfig))
    }
    const said = (id: string) =>
      entryLineOf(
        claims.find((one) => one.id === id)!,
        withFile,
        null,
        words,
      )
    // given up by its owner: the account's own word, not the one for a
    // question taken out of the paper
    expect(said('given-up').act).toBe('abandoned')
    expect(said('given-up').action.id).toBe(m.resultActAbandoned.id)
    expect(said('revoked').action.id).toBe(m.entriesActRevoked.id)
    // one that went with its question it was filed under: voided, in the
    // row's word and its amount's, never given up
    const withdrawn: ItemDto = { ...withFile, status: 'voided' }
    const gone = entryLineOf(claims[0]!, withdrawn, null, words)
    expect(gone.action.id).toBe(m.entriesActVoided.id)
    expect(gone.amountWord.id).toBe(m.entryStatusVoided.id)
    // an ask with nothing written in it carries no words to show
    expect(said('asked').note).toEqual({ kind: 'ask', text: 'a stamped copy' })
    expect(said('blank-ask').note).toBeNull()
    expect(said('asked').files).toBe(2)
  })
})

describe('the dot beside a question', () => {
  it('says where it stands whether or not there is news on it', () => {
    for (const tag of ['needs_revision', 'approved', 'in_review', 'rejected', null] as const) {
      const quiet = row({ id: 'q', kind: 'item', tag })
      expect(dotOf({ ...quiet, unread: 2 })).toBe(dotOf(quiet))
    }
  })
})

describe('why a new claim cannot be started', () => {
  const said = (reason: string | null, round: RoundState | null) =>
    filingHeldOf(reason, round).message.id

  it('names the stage that shut it, where the round names one', () => {
    const during = filingHeldOf('phase-closed', { status: 'active', phaseName: ' 材料审核 ' })
    expect(during.message.id).toBe('assessment/entries/held-phase')
    expect(during.values).toEqual({ phase: '材料审核' })
    expect(said('phase-closed', { status: 'active', phaseName: null })).toBe(
      'assessment/entries/held-now',
    )
  })

  it('tells an archived round and one not begun from a round between stages', () => {
    expect(said('no-active-phase', { status: 'archived', phaseName: null })).toBe(
      'assessment/entries/held-archived',
    )
    expect(said('no-active-phase', { status: 'draft', phaseName: null })).toBe(
      'assessment/entries/held-not-started',
    )
    expect(said('no-active-phase', { status: 'active', phaseName: null })).toBe(
      'assessment/entries/held-no-phase',
    )
  })

  it('says a stage open to others only, and a round already full', () => {
    expect(said('item-out-of-scope', null)).toBe('assessment/entries/held-item-scope')
    expect(said('participant-out-of-scope', null)).toBe('assessment/entries/held-participant-scope')
    expect(said('account-ceiling-reached', null)).toBe('assessment/entries/held-round-full')
    expect(said('something-new', null)).toBe('assessment/entries/held-now')
  })
})

describe('which way the pane arrives', () => {
  const outline = outlineOf([
    row({ id: 'a' }),
    row({ id: 'a1', kind: 'item', depth: 1, parentId: 'a' }),
    row({ id: 'a2', kind: 'item', depth: 1, parentId: 'a' }),
    row({ id: 'b' }),
    row({ id: 'b1', kind: 'item', depth: 1, parentId: 'b' }),
  ])

  it('goes out to a section above, in to what a section holds, along otherwise', () => {
    expect(moveBetween(outline, 'a2', 'a')).toBe('out')
    expect(moveBetween(outline, 'a', 'a1')).toBe('in')
    expect(moveBetween(outline, 'a1', 'a2')).toBe('next')
    expect(moveBetween(outline, 'b1', 'a2')).toBe('previous')
  })

  it('draws no arrival where nothing moved, or nothing was shown before', () => {
    expect(moveBetween(outline, 'a1', 'a1')).toBe('none')
    expect(moveBetween(outline, null, 'a1')).toBe('none')
    expect(moveBetween(outline, 'gone', 'a1')).toBe('none')
  })
})
