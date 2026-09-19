import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { provenColumns } from '../src/administrative-import/columns.ts'
import {
  buildAdministrativeWorkbook,
  DATA_SHEET,
  META_SHEET,
  parseAdministrativeWorkbook,
  type TemplateMetadata,
  type TemplateSpec,
} from '../src/administrative-import/workbook.ts'

// What a tampered hidden sheet can and cannot make an import mean.
//
// The `_qualy` sheet is `veryHidden`, which is a spreadsheet's way of keeping
// something out of the way - not a signature. Anyone who can fill a template
// in can open it and rewrite it. So the question every case here asks is the
// one the value checks downstream cannot: not "is the stored value legal",
// which a remapped label satisfies perfectly, but "is it the reading the
// person who filled this in saw on screen".
//
// The answer is that the file may say WHERE a field is, and nothing else. The
// type, the words each stored value wears, and which field a column is at all
// come from the frozen revision; the heading the person read is what proves
// the placement.

const BATCH = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const REVISION = '33333333-3333-4333-8333-333333333333'

const spec = (over: Partial<TemplateSpec> = {}): TemplateSpec => ({
  batchId: BATCH,
  itemId: ITEM,
  itemRevisionId: REVISION,
  itemTitle: '荣誉称号',
  locale: 'zh-CN',
  evidence: [
    { key: 'summary', schema: { type: 'string', title: '事项说明' } },
    { key: 'note', schema: { type: 'string', title: '备注' } },
  ],
  recognition: [
    {
      id: 'rec-level',
      schema: {
        type: 'string',
        enum: ['national', 'provincial'],
        title: '级别',
        'x-qualy-enumLabels': { national: '国家级', provincial: '省级' },
      } as never,
    },
  ],
  ...over,
})

/** the question as the server knows it, which is what a file is proven against */
const question = (over: Partial<TemplateSpec> = {}) => {
  const full = spec(over)
  return { locale: full.locale, evidence: full.evidence, recognition: full.recognition }
}

/**
 * A template, filled in, with its hidden sheet rewritten by whoever is
 * attacking it - and optionally the visible sheet too, which is the honest
 * case: a document that says what it does.
 */
const tampered = async (
  edit: (metadata: TemplateMetadata) => unknown,
  visible?: (sheet: ExcelJS.Worksheet) => void,
) => {
  const template = await buildAdministrativeWorkbook(spec())
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(template as unknown as ArrayBuffer)
  book
    .getWorksheet(DATA_SHEET)!
    .addRow(['0001', '张三', '入伍', '备注', '国家级', '校发〔2026〕7 号'])
  visible?.(book.getWorksheet(DATA_SHEET)!)
  const meta = book.getWorksheet(META_SHEET)!.getRow(1).getCell(1)
  const current = JSON.parse(String(meta.value)) as TemplateMetadata
  meta.value = JSON.stringify(edit(current))
  return new Uint8Array((await book.xlsx.writeBuffer()) as ArrayBuffer)
}

/** the reasons a parse refused with, or the reasons the proof refused with */
const refusedBy = async (bytes: Uint8Array) => {
  const parsed = await parseAdministrativeWorkbook(bytes).catch((error: unknown) => error)
  if (parsed instanceof Error) return [(parsed as { reason?: string }).reason ?? parsed.message]
  const proven = provenColumns(parsed as never, question())
  return 'refusals' in proven ? proven.refusals.map((one) => one.reason) : []
}

describe('what the hidden sheet is allowed to decide', () => {
  it('reads an untouched template as the question itself declares it', async () => {
    const bytes = await tampered((metadata) => metadata)
    const parsed = await parseAdministrativeWorkbook(bytes)
    const proven = provenColumns(parsed, question())
    if ('refusals' in proven) throw new Error(`refused: ${JSON.stringify(proven.refusals)}`)
    expect(proven.columns).toEqual([
      { column: 'C', kind: 'evidence', key: 'summary', type: 'text', header: '事项说明' },
      { column: 'D', kind: 'evidence', key: 'note', type: 'text', header: '备注' },
      {
        column: 'E',
        kind: 'recognition',
        key: 'rec-level',
        type: 'choice',
        header: '认定：级别',
        choices: [
          { value: 'national', label: '国家级' },
          { value: 'provincial', label: '省级' },
        ],
      },
    ])
  })

  it('imports its own template when a title carries stray space', async () => {
    // The reader trims what it finds in the cell; the header it is compared
    // against is the field's annotated title as written. With the space
    // taken off only one side, a title like this made the template THIS
    // question writes impossible to import, explained by nothing but an
    // internal code.
    const spaced = {
      evidence: [
        { key: 'summary', schema: { type: 'string' as const, title: ' 事项说明 ' } },
        { key: 'note', schema: { type: 'string' as const, title: '备注' } },
      ],
    }
    const bytes = await buildAdministrativeWorkbook(spec(spaced))
    const parsed = await parseAdministrativeWorkbook(bytes)
    const proven = provenColumns(parsed, question(spaced))
    if ('refusals' in proven) throw new Error(`refused: ${JSON.stringify(proven.refusals)}`)
    expect(proven.columns.map((one) => one.key)).toEqual(['summary', 'note', 'rec-level'])
  })

  it('takes the words a value wears from the question, not from the file', async () => {
    // the attack this whole shape exists for: the visible sheet still reads
    // 国家级, and the hidden one says that word means `provincial`
    const bytes = await tampered((metadata) => metadata)
    const parsed = await parseAdministrativeWorkbook(bytes)
    const proven = provenColumns(parsed, question())
    if ('refusals' in proven) throw new Error('unexpected refusal')
    const level = proven.columns.find((one) => one.key === 'rec-level')!
    // there is nowhere for a swapped label to come from: the choices are the
    // question's own, whatever the file carried
    expect(level.choices).toEqual([
      { value: 'national', label: '国家级' },
      { value: 'provincial', label: '省级' },
    ])
    expect(JSON.stringify(parsed.metadata)).not.toContain('国家级')
  })

  it('refuses two fields that swapped places without the headings moving', async () => {
    const bytes = await tampered((metadata) => ({
      ...metadata,
      columns: metadata.columns.map((one) =>
        one.key === 'summary'
          ? { ...one, key: 'note' }
          : one.key === 'note'
            ? { ...one, key: 'summary' }
            : one,
      ),
    }))
    // both fields are still present exactly once, both are legal text, and
    // the values would have gone into each other's columns
    expect(await refusedBy(bytes)).toEqual(['column-header-mismatch', 'column-header-mismatch'])
  })

  it('accepts a swap the visible sheet actually made', async () => {
    // a person who really did reorder the columns moved the headings too,
    // and then the document says what it does
    const bytes = await tampered(
      (metadata) => ({
        ...metadata,
        columns: metadata.columns.map((one) =>
          one.key === 'summary'
            ? { ...one, column: 'D' }
            : one.key === 'note'
              ? { ...one, column: 'C' }
              : one,
        ),
      }),
      (sheet) => {
        sheet.getRow(1).getCell('C').value = '备注'
        sheet.getRow(1).getCell('D').value = '事项说明'
      },
    )
    const parsed = await parseAdministrativeWorkbook(bytes)
    const proven = provenColumns(parsed, question())
    if ('refusals' in proven) throw new Error(`refused: ${JSON.stringify(proven.refusals)}`)
    expect(proven.columns.map((one) => [one.key, one.column])).toEqual([
      ['summary', 'D'],
      ['note', 'C'],
      ['rec-level', 'E'],
    ])
  })

  it('refuses a field the question does not have', async () => {
    const bytes = await tampered((metadata) => ({
      ...metadata,
      columns: [...metadata.columns, { column: 'Z', kind: 'evidence', key: 'invented' }],
    }))
    expect(await refusedBy(bytes)).toEqual(['column-unknown'])
  })

  it('refuses a field the file left out', async () => {
    const bytes = await tampered((metadata) => ({
      ...metadata,
      columns: metadata.columns.filter((one) => one.key !== 'note'),
    }))
    expect(await refusedBy(bytes)).toEqual(['column-missing'])
  })

  it('refuses a field claimed under the wrong half of the question', async () => {
    const bytes = await tampered((metadata) => ({
      ...metadata,
      columns: metadata.columns.map((one) =>
        one.key === 'summary' ? { ...one, kind: 'recognition' } : one,
      ),
    }))
    // as a recognition it is neither the evidence field the question wants
    // nor a determination it has
    expect(await refusedBy(bytes)).toEqual(['column-missing', 'column-unknown'])
  })

  it('refuses the same field claimed twice', async () => {
    const bytes = await tampered((metadata) => ({
      ...metadata,
      columns: [...metadata.columns, { column: 'Z', kind: 'evidence', key: 'summary' }],
    }))
    expect(await refusedBy(bytes)).toEqual(['metadata-corrupt'])
  })

  it('refuses two fields claiming one column', async () => {
    const bytes = await tampered((metadata) => ({
      ...metadata,
      columns: metadata.columns.map((one) => ({ ...one, column: 'C' })),
    }))
    expect(await refusedBy(bytes)).toEqual(['metadata-corrupt'])
  })

  it('refuses a column letter that is not one', async () => {
    const bytes = await tampered((metadata) => ({
      ...metadata,
      columns: metadata.columns.map((one) =>
        one.key === 'summary' ? { ...one, column: 'C1:ZZ9' } : one,
      ),
    }))
    expect(await refusedBy(bytes)).toEqual(['metadata-corrupt'])
  })

  it('refuses a column past the ceiling a workbook may reach', async () => {
    const bytes = await tampered((metadata) => ({
      ...metadata,
      columns: metadata.columns.map((one) =>
        one.key === 'summary' ? { ...one, column: 'ZZZ' } : one,
      ),
    }))
    expect(await refusedBy(bytes)).toEqual(['too-many-columns'])
  })

  it('refuses a language the product does not have', async () => {
    const bytes = await tampered((metadata) => ({ ...metadata, locale: 'xx-YY' }))
    expect(await refusedBy(bytes)).toEqual(['metadata-corrupt'])
  })
})
