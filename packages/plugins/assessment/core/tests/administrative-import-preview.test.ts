import { describe, expect, it } from 'vitest'
import {
  judgeRows,
  markDuplicateFacts,
  readCell,
  summarise,
  WRITTEN_TEXT_WIDTHS,
  type PreviewInput,
} from '../src/administrative-import/preview.ts'
import { MAX_ENTRIES_PER_ITEM } from '../src/api.ts'
import type { ParsedWorkbook, TemplateColumn } from '../src/administrative-import/workbook.ts'
import { AdministrativeEntryImportRow, EntryRevision } from '../src/db/entities.ts'

// Judging a workbook without writing anything.
//
// The rule this suite exists for is that a preview and the write that
// follows must reach the same answer. Everything here is the part of that
// answer which depends only on values - the part a person can get wrong a
// hundred and twenty times in one file, and is owed all at once.

const column = (over: Partial<TemplateColumn> & Pick<TemplateColumn, 'key' | 'type'>) =>
  ({ column: 'C', kind: 'evidence', header: over.key, ...over }) as TemplateColumn

/** the columns as a template would place them: C onwards, one letter each */
const placed = (columns: readonly TemplateColumn[]): readonly TemplateColumn[] =>
  columns.map((one, at) => ({ ...one, column: String.fromCharCode(67 + at) }))

const parsed = (
  columns: readonly TemplateColumn[],
  rows: readonly {
    rowNo: number
    businessNo: string
    displayName: string
    cells: Record<string, string>
    basis: string
  }[],
): ParsedWorkbook => ({
  metadata: {
    templateVersion: 2,
    batchId: 'b',
    itemId: 'i',
    itemRevisionId: 'r',
    locale: 'zh-CN',
    columns: columns.map(({ column: at, kind, key }) => ({ column: at, kind, key })),
  },
  headers: Object.fromEntries(columns.map((one) => [one.column, one.header])),
  // the fixtures write cells under the field key, which reads better; the
  // parser hands them over under the column letter, so translate once here
  rows: rows.map((one) => ({
    ...one,
    cells: Object.fromEntries(
      Object.entries(one.cells).map(([key, text]) => [
        columns.find((found) => found.key === key)?.column ?? key,
        text,
      ]),
    ),
  })),
  unread: null,
})

const base = (over: Partial<PreviewInput> & Pick<PreviewInput, 'parsed'>): PreviewInput => ({
  columns: [],
  defaultBasis: '校发〔2026〕7 号',
  reachable: new Map(),
  evidenceSchemas: new Map(),
  recognitionSchemas: new Map(),
  requiredRecognitionIds: [],
  held: new Map(),
  maxEntries: null,
  actorUserId: 'staff',
  participantUserIds: new Map(),
  ...over,
})

const reachable = (businessNo: string, id: string, displayName: string) =>
  new Map([[businessNo, { id, displayName, businessNo }]])

const reasonsOf = (rows: ReturnType<typeof judgeRows>) =>
  rows.flatMap((row) => row.issues.map((one) => one.reason))

describe('reading one cell as the type its column declares', () => {
  it('keeps a decimal as text all the way through', () => {
    // a calculator handed an IEEE double has already lost the question
    expect(readCell(column({ key: 'x', type: 'decimal' }), undefined, '0.10')).toEqual({
      value: '0.10',
    })
    expect(readCell(column({ key: 'x', type: 'decimal' }), undefined, '1e3')).toEqual({
      reason: 'decimal-syntax',
    })
  })

  it('refuses an integer that is not safe rather than rounding it', () => {
    expect(readCell(column({ key: 'x', type: 'integer' }), undefined, '12')).toEqual({ value: 12 })
    expect(
      readCell(column({ key: 'x', type: 'integer' }), undefined, '900719925474099100'),
    ).toEqual({ reason: 'integer-range' })
    expect(readCell(column({ key: 'x', type: 'integer' }), undefined, '1.5')).toEqual({
      reason: 'integer-syntax',
    })
  })

  it('holds a date to the shape the template asked for', () => {
    expect(readCell(column({ key: 'x', type: 'date' }), undefined, '2026-03-01')).toEqual({
      value: '2026-03-01',
    })
    expect(readCell(column({ key: 'x', type: 'date' }), undefined, '2026/3/1')).toEqual({
      reason: 'date-syntax',
    })
  })

  it('reads a choice by the word the file shows, and by its stable value', () => {
    const choice = column({
      key: 'x',
      type: 'choice',
      choices: [
        { label: '国家级 [national]', value: 'national' },
        { label: '省级', value: 'provincial' },
      ],
    })
    // the disambiguated label is what the template printed
    expect(readCell(choice, undefined, '国家级 [national]')).toEqual({ value: 'national' })
    expect(readCell(choice, undefined, '省级')).toEqual({ value: 'provincial' })
    // somebody who pasted a column out of another system has not erred
    expect(readCell(choice, undefined, 'national')).toEqual({ value: 'national' })
    expect(readCell(choice, undefined, '国家级')).toEqual({ reason: 'choice-unknown' })
  })

  it('reads a boolean as the two words the template offers', () => {
    const flag = column({ key: 'x', type: 'boolean' })
    expect(readCell(flag, undefined, '是')).toEqual({ value: true })
    expect(readCell(flag, undefined, '否')).toEqual({ value: false })
    expect(readCell(flag, undefined, '1')).toEqual({ reason: 'boolean-syntax' })
  })
})

describe('judging a whole workbook', () => {
  it('says the same thing for unknown, excluded and out of reach', () => {
    const rows = judgeRows(
      base({
        parsed: parsed(
          [],
          [
            { rowNo: 2, businessNo: '0001', displayName: '张三', cells: {}, basis: '' },
            { rowNo: 3, businessNo: '', displayName: '', cells: {}, basis: '' },
          ],
        ),
        reachable: new Map(),
      }),
    )
    // one answer for all three refusals, or the import door is a directory
    expect(rows[0]!.issues.map((one) => one.reason)).toEqual(['participant-not-found'])
    expect(rows[0]!.matchedParticipant).toBeNull()
    expect(rows[1]!.issues.map((one) => one.reason)).toEqual(['business-no-required'])
  })

  it('refuses a row about the person filing it', () => {
    const rows = judgeRows(
      base({
        parsed: parsed(
          [],
          [{ rowNo: 2, businessNo: '0001', displayName: '张三', cells: {}, basis: '文件' }],
        ),
        reachable: reachable('0001', 'p1', '张三'),
        participantUserIds: new Map([['p1', 'staff']]),
      }),
    )
    // approved on write with no reviewer, so the two people must be two
    expect(reasonsOf(rows)).toContain('self-record-refused')
  })

  it('warns about a name that does not match, and does not block on it', () => {
    const rows = judgeRows(
      base({
        parsed: parsed(
          [],
          [{ rowNo: 2, businessNo: '0001', displayName: '张山', cells: {}, basis: '文件' }],
        ),
        reachable: reachable('0001', 'p1', '张三'),
        participantUserIds: new Map([['p1', 'u1']]),
      }),
    )
    expect(rows[0]!.issues).toEqual([
      { severity: 'warning', field: 'displayName', reason: 'name-mismatch' },
    ])
    expect(summarise(rows)).toEqual({ rows: 1, valid: 1, warnings: 1, errors: 0 })
  })

  it('takes the row basis over the shared one, and refuses when neither is there', () => {
    const input = base({
      parsed: parsed(
        [],
        [
          { rowNo: 2, businessNo: '0001', displayName: '张三', cells: {}, basis: '本行依据' },
          { rowNo: 3, businessNo: '0001', displayName: '张三', cells: {}, basis: '' },
        ],
      ),
      reachable: reachable('0001', 'p1', '张三'),
      participantUserIds: new Map([['p1', 'u1']]),
    })
    const withShared = judgeRows(input)
    expect(withShared[0]!.basis).toBe('本行依据')
    expect(withShared[1]!.basis).toBe('校发〔2026〕7 号')

    const without = judgeRows({ ...input, defaultBasis: '   ' })
    // an administrative fact nobody can check is an assertion
    expect(without[1]!.issues.map((one) => one.reason)).toContain('basis-required')
  })

  it('holds the name and the basis to the columns they are written into', () => {
    const person = {
      reachable: reachable('0001', 'p1', '张三'),
      participantUserIds: new Map([['p1', 'u1']]),
    }
    const row = (rowNo: number, displayName: string, basis: string) => ({
      rowNo,
      businessNo: '0001',
      displayName,
      cells: {},
      basis,
    })
    const rows = judgeRows(
      base({
        ...person,
        parsed: parsed(
          [],
          [
            row(2, '张三', '依'.repeat(WRITTEN_TEXT_WIDTHS.basis)),
            row(3, '张三', '依'.repeat(WRITTEN_TEXT_WIDTHS.basis + 1)),
            row(4, '李'.repeat(WRITTEN_TEXT_WIDTHS.displayName + 1), '文件'),
            // a column counts characters: an emoji is one, not the two
            // units a string's length would call it
            row(5, '张三', '🎖'.repeat(WRITTEN_TEXT_WIDTHS.basis)),
          ],
        ),
      }),
    )
    // the four rows are one fact about one person, which is a warning of its
    // own and not what this is about
    const errors = rows.map((one) => one.issues.filter((found) => found.severity === 'error'))
    // exactly as wide as the column is written as it is
    expect(errors[0]).toEqual([])
    expect(errors[1]).toEqual([{ severity: 'error', field: 'basis', reason: 'too-long' }])
    // an error, not the name-mismatch warning: it could not be kept either way
    expect(errors[2]).toEqual([{ severity: 'error', field: 'displayName', reason: 'too-long' }])
    expect(rows[2]!.issues.map((one) => one.reason)).not.toContain('name-mismatch')
    expect(errors[3]).toEqual([])

    // the shared basis lands in the same column as a row's own
    const shared = judgeRows(
      base({
        ...person,
        parsed: parsed([], [row(2, '张三', '')]),
        defaultBasis: '依'.repeat(WRITTEN_TEXT_WIDTHS.basis + 1),
      }),
    )
    expect(shared[0]!.issues).toEqual([{ severity: 'error', field: 'basis', reason: 'too-long' }])
  })

  it('knows the widths the entities declare, not a copy that could drift from them', () => {
    expect(WRITTEN_TEXT_WIDTHS).toEqual({
      displayName: AdministrativeEntryImportRow.meta.properties.displayNameSnapshot.length,
      basis: EntryRevision.meta.properties.note.length,
    })
  })

  it('refuses a determination the question requires and the file left out', () => {
    const rows = judgeRows(
      base({
        columns: placed([
          column({ key: 'rec-level', type: 'choice', kind: 'recognition', choices: [] }),
        ]),
        parsed: parsed(
          placed([column({ key: 'rec-level', type: 'choice', kind: 'recognition', choices: [] })]),
          [{ rowNo: 2, businessNo: '0001', displayName: '张三', cells: {}, basis: '文件' }],
        ),
        reachable: reachable('0001', 'p1', '张三'),
        participantUserIds: new Map([['p1', 'u1']]),
        requiredRecognitionIds: ['rec-level'],
      }),
    )
    expect(reasonsOf(rows)).toContain('recognition-required')
  })

  it('counts quota across the file as well as against the database', () => {
    const rows = judgeRows(
      base({
        parsed: parsed(
          [],
          [
            { rowNo: 2, businessNo: '0001', displayName: '张三', cells: {}, basis: '甲' },
            { rowNo: 3, businessNo: '0001', displayName: '张三', cells: {}, basis: '乙' },
            { rowNo: 4, businessNo: '0001', displayName: '张三', cells: {}, basis: '丙' },
          ],
        ),
        reachable: reachable('0001', 'p1', '张三'),
        participantUserIds: new Map([['p1', 'u1']]),
        maxEntries: 2,
        held: new Map([['p1', 1]]),
      }),
    )
    // one already held plus two in the file is one too many, and the row it
    // is too many AT is the one named
    expect(rows[0]!.issues.map((one) => one.reason)).not.toContain('max-entries-reached')
    expect(rows[1]!.issues.map((one) => one.reason)).toContain('max-entries-reached')
    expect(rows[2]!.issues.map((one) => one.reason)).toContain('max-entries-reached')
  })

  it('stops a question with no limit of its own at the platform ceiling', () => {
    const rows = judgeRows(
      base({
        parsed: parsed(
          [],
          [
            { rowNo: 2, businessNo: '0001', displayName: '张三', cells: {}, basis: '甲' },
            { rowNo: 3, businessNo: '0001', displayName: '张三', cells: {}, basis: '乙' },
          ],
        ),
        reachable: reachable('0001', 'p1', '张三'),
        participantUserIds: new Map([['p1', 'u1']]),
        maxEntries: null,
        held: new Map([['p1', MAX_ENTRIES_PER_ITEM - 1]]),
      }),
    )
    // "no limit" is no business rule, not no ceiling: the last place is
    // taken by the first row, and the second is past it
    expect(rows[0]!.issues.map((one) => one.reason)).not.toContain('entry-ceiling-reached')
    expect(rows[1]!.issues.map((one) => one.reason)).toContain('entry-ceiling-reached')
  })

  it('warns about the same fact twice, and is not fooled by a different basis', () => {
    const rows = markDuplicateFacts(
      judgeRows(
        base({
          columns: placed([column({ key: 'summary', type: 'text' })]),
          parsed: parsed(placed([column({ key: 'summary', type: 'text' })]), [
            {
              rowNo: 2,
              businessNo: '0001',
              displayName: '张三',
              cells: { summary: '入伍' },
              basis: '甲',
            },
            {
              rowNo: 3,
              businessNo: '0001',
              displayName: '张三',
              cells: { summary: '入伍' },
              // a different basis is not a different fact
              basis: '乙',
            },
          ]),
          reachable: reachable('0001', 'p1', '张三'),
          participantUserIds: new Map([['p1', 'u1']]),
        }),
      ),
    )
    expect(rows[0]!.issues).toEqual([])
    expect(rows[1]!.issues.map((one) => one.reason)).toEqual(['duplicate-in-file'])
    // a warning, never a refusal: some questions are won more than once
    expect(summarise(rows).errors).toBe(0)
  })

  it('collects every mistake rather than stopping at the first', () => {
    const rows = judgeRows(
      base({
        columns: placed([
          column({ key: 'when', type: 'date' }),
          column({ key: 'score', type: 'integer' }),
        ]),
        parsed: parsed(
          placed([
            column({ key: 'when', type: 'date' }),
            column({ key: 'score', type: 'integer' }),
          ]),
          [
            {
              rowNo: 2,
              businessNo: '9999',
              displayName: '',
              cells: { when: '2026/3/1', score: 'x' },
              basis: '',
            },
          ],
        ),
        reachable: new Map(),
        defaultBasis: '',
      }),
    )
    // somebody who filled in a hundred rows is owed the whole list
    expect(rows[0]!.issues.map((one) => one.reason).sort()).toEqual([
      'basis-required',
      'date-syntax',
      'integer-syntax',
      'participant-not-found',
    ])
  })
})
