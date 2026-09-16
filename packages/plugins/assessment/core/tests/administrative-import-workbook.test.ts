import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_IMPORT_LIMITS,
  buildAdministrativeWorkbook,
  columnLetter,
  DATA_SHEET,
  META_SHEET,
  parseAdministrativeWorkbook,
  TEMPLATE_VERSION,
  WorkbookUnreadable,
  type TemplateSpec,
} from '../src/administrative-import/workbook.ts'

// The file, and nothing but the file.
//
// This module answers one question - what does the workbook say - and the
// point of testing it alone is that Excel's edge cases are the expensive
// part: a leading zero eaten by a spreadsheet, a formula whose cached result
// is somebody else's arithmetic, a tail of rows that look real and are
// empty, two enum values that print the same word. None of that needs a
// database to go wrong, and none of it should need one to be caught.

const BATCH = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const REVISION = '33333333-3333-4333-8333-333333333333'

const spec = (over: Partial<TemplateSpec> = {}): TemplateSpec => ({
  batchId: BATCH,
  itemId: ITEM,
  itemRevisionId: REVISION,
  itemTitle: '荣誉称号',
  locale: 'zh-CN',
  evidence: [{ key: 'summary', schema: { type: 'string', title: '事项说明' } }],
  recognition: [
    {
      id: 'rec-level',
      schema: { type: 'string', enum: ['national', 'provincial'], title: '级别' },
    },
  ],
  ...over,
})

/** a filled-in copy of whatever template the spec produces */
const filled = async (
  template: Uint8Array,
  rows: readonly (readonly (string | null)[])[],
  edit?: (book: ExcelJS.Workbook) => void,
) => {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(template as unknown as ArrayBuffer)
  const sheet = book.getWorksheet(DATA_SHEET)!
  for (const row of rows) sheet.addRow([...row])
  edit?.(book)
  return new Uint8Array((await book.xlsx.writeBuffer()) as ArrayBuffer)
}

describe('the administrative import workbook', () => {
  it('writes the columns the question declares, and says what each one is', async () => {
    const bytes = await buildAdministrativeWorkbook(spec())
    const parsed = await parseAdministrativeWorkbook(bytes)

    expect(parsed.metadata.templateVersion).toBe(TEMPLATE_VERSION)
    expect(parsed.metadata.batchId).toBe(BATCH)
    expect(parsed.metadata.itemRevisionId).toBe(REVISION)
    // identity first, then the question's own fields, then the determination
    expect(parsed.metadata.columns).toEqual([
      { column: 'C', kind: 'evidence', key: 'summary', type: 'text' },
      {
        column: 'D',
        kind: 'recognition',
        key: 'rec-level',
        type: 'choice',
        choices: [
          { value: 'national', label: 'national' },
          { value: 'provincial', label: 'provincial' },
        ],
      },
    ])
    // an empty template is an empty template, not one row of nothing
    expect(parsed.rows).toEqual([])
  })

  it('keeps a business number that starts with a zero', async () => {
    const bytes = await filled(await buildAdministrativeWorkbook(spec()), [
      ['0012340', '张三', '入伍', 'national', '校发〔2026〕7 号'],
    ])
    const parsed = await parseAdministrativeWorkbook(bytes)
    // the whole reason the column is formatted as text: 0012340 is an
    // identifier, and 12340 is a different person or nobody
    expect(parsed.rows[0]!.businessNo).toBe('0012340')
    expect(parsed.rows[0]!.cells['summary']).toBe('入伍')
    expect(parsed.rows[0]!.cells['rec-level']).toBe('national')
    expect(parsed.rows[0]!.basis).toBe('校发〔2026〕7 号')
    expect(parsed.rows[0]!.rowNo).toBe(2)
  })

  it('refuses a formula rather than trusting what it last evaluated to', async () => {
    const bytes = await filled(
      await buildAdministrativeWorkbook(spec()),
      [['0012340', '张三', null, 'national', '校发〔2026〕7 号']],
      (book) => {
        const sheet = book.getWorksheet(DATA_SHEET)!
        // the library never runs this; it hands back whatever was cached,
        // which is somebody else's arithmetic
        sheet.getRow(2).getCell('C').value = { formula: 'B2&"!"', result: '张三!' }
      },
    )
    const refused = await parseAdministrativeWorkbook(bytes).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(WorkbookUnreadable)
    expect((refused as WorkbookUnreadable).reason).toBe('formula-not-allowed')
    // and it says where to look
    expect((refused as WorkbookUnreadable).rowNo).toBe(2)
    expect((refused as WorkbookUnreadable).column).toBe('C')
  })

  it('tells two choices with the same word apart', async () => {
    const bytes = await buildAdministrativeWorkbook(
      spec({
        recognition: [
          {
            id: 'rec-level',
            schema: {
              type: 'string',
              enum: ['national', 'national-special'],
              title: '级别',
              // both print the same word, which a file cannot carry
              'x-qualy-enumLabels': { national: '国家级', 'national-special': '国家级' },
            } as never,
          },
        ],
      }),
    )
    const parsed = await parseAdministrativeWorkbook(bytes)
    expect(parsed.metadata.columns[1]!.choices).toEqual([
      { value: 'national', label: '国家级 [national]' },
      { value: 'national-special', label: '国家级 [national-special]' },
    ])
  })

  it('leaves a label alone when nothing collides with it', async () => {
    const bytes = await buildAdministrativeWorkbook(
      spec({
        recognition: [
          {
            id: 'rec-level',
            schema: {
              type: 'string',
              enum: ['national', 'provincial'],
              'x-qualy-enumLabels': { national: '国家级', provincial: '省级' },
            } as never,
          },
        ],
      }),
    )
    const parsed = await parseAdministrativeWorkbook(bytes)
    expect(parsed.metadata.columns[1]!.choices).toEqual([
      { value: 'national', label: '国家级' },
      { value: 'provincial', label: '省级' },
    ])
  })

  it('reads a date cell as the day the file shows, not as an instant', async () => {
    const bytes = await filled(
      await buildAdministrativeWorkbook(
        spec({ evidence: [{ key: 'when', schema: { type: 'string', format: 'date' } }] }),
      ),
      [['0012340', '张三', null, 'national', '校发〔2026〕7 号']],
      (book) => {
        const sheet = book.getWorksheet(DATA_SHEET)!
        sheet.getRow(2).getCell('C').value = new Date(Date.UTC(2026, 2, 1))
      },
    )
    const parsed = await parseAdministrativeWorkbook(bytes)
    // a serial date read as an instant drifts by a timezone, and a drifted
    // date can fall outside the round's material range
    expect(parsed.rows[0]!.cells['when']).toBe('2026-03-01')
  })

  it('does not count the blank tail a spreadsheet leaves behind', async () => {
    const bytes = await filled(await buildAdministrativeWorkbook(spec()), [
      ['0012340', '张三', '入伍', 'national', '校发〔2026〕7 号'],
      ['', '', '', '', ''],
      ['0012341', '李四', '入伍', 'provincial', '校发〔2026〕8 号'],
      ['', '', '', '', ''],
      ['', '', '', '', ''],
    ])
    const parsed = await parseAdministrativeWorkbook(bytes)
    expect(parsed.rows.map((row) => row.businessNo)).toEqual(['0012340', '0012341'])
    // and the row numbers are the file's, so an issue names where to look
    expect(parsed.rows.map((row) => row.rowNo)).toEqual([2, 4])
  })

  it('refuses a workbook that is not one, and one whose metadata is gone', async () => {
    const notXlsx = await parseAdministrativeWorkbook(
      new TextEncoder().encode('this is not a spreadsheet'),
    ).catch((error: unknown) => error)
    expect((notXlsx as WorkbookUnreadable).reason).toBe('not-xlsx')

    const book = new ExcelJS.Workbook()
    book.addWorksheet(DATA_SHEET).addRow(['业务编号 *', '姓名'])
    const noMeta = new Uint8Array((await book.xlsx.writeBuffer()) as ArrayBuffer)
    const missing = await parseAdministrativeWorkbook(noMeta).catch((error: unknown) => error)
    expect((missing as WorkbookUnreadable).reason).toBe('metadata-missing')
  })

  it('refuses a template from a version it does not read', async () => {
    const bytes = await filled(await buildAdministrativeWorkbook(spec()), [], (book) => {
      const meta = book.getWorksheet(META_SHEET)!
      const said = JSON.parse(String(meta.getRow(1).getCell(1).value))
      meta.getRow(1).getCell(1).value = JSON.stringify({ ...said, templateVersion: 99 })
    })
    const refused = await parseAdministrativeWorkbook(bytes).catch((error: unknown) => error)
    expect((refused as WorkbookUnreadable).reason).toBe('unsupported-template-version')
  })

  it('refuses hand-edited metadata rather than guessing what it meant', async () => {
    const bytes = await filled(await buildAdministrativeWorkbook(spec()), [], (book) => {
      book.getWorksheet(META_SHEET)!.getRow(1).getCell(1).value = '{ not json'
    })
    const refused = await parseAdministrativeWorkbook(bytes).catch((error: unknown) => error)
    expect((refused as WorkbookUnreadable).reason).toBe('metadata-corrupt')
  })

  it('refuses more rows than one request is allowed to carry', async () => {
    const many = Array.from({ length: ADMIN_IMPORT_LIMITS.maxRows + 2 }, (_, at) => [
      String(at + 1).padStart(7, '0'),
      '张三',
      '入伍',
      'national',
      '校发〔2026〕7 号',
    ])
    const bytes = await filled(await buildAdministrativeWorkbook(spec()), many)
    const refused = await parseAdministrativeWorkbook(bytes).catch((error: unknown) => error)
    // the limit is what keeps one http request from becoming a batch job
    expect((refused as WorkbookUnreadable).reason).toBe('too-many-rows')
  })

  it('refuses a file too large to be worth opening', async () => {
    const huge = new Uint8Array(ADMIN_IMPORT_LIMITS.maxFileBytes + 1)
    const refused = await parseAdministrativeWorkbook(huge).catch((error: unknown) => error)
    expect((refused as WorkbookUnreadable).reason).toBe('file-too-large')
  })

  it('names columns the way a spreadsheet does', () => {
    expect([1, 2, 26, 27, 28, 52, 53].map(columnLetter)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
    ])
  })
})
