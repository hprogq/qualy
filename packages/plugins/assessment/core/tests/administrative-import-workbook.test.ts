import zlib from 'node:zlib'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { ArchiveRefused, inspectArchive } from '@qualy/spreadsheet/archive'
import {
  ADMIN_IMPORT_LIMITS,
  buildAdministrativeWorkbook,
  columnLetter,
  DATA_SHEET,
  META_SHEET,
  parseAdministrativeWorkbook,
  templateLayout,
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
  businessNoLabel: '学工号',
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
    // the FILE says only where each field is; what a field is belongs to the
    // question, and the hidden sheet is not allowed to have an opinion on it
    expect(parsed.metadata.columns).toEqual([
      { column: 'C', kind: 'evidence', key: 'summary' },
      { column: 'D', kind: 'recognition', key: 'rec-level' },
    ])
    expect(parsed.metadata.locale).toBe('zh-CN')
    // identity first, then the question's own fields, then the determination
    expect(templateLayout(spec()).columns).toEqual([
      { column: 'C', kind: 'evidence', key: 'summary', type: 'text', header: '事项说明' },
      {
        column: 'D',
        kind: 'recognition',
        key: 'rec-level',
        type: 'choice',
        header: '认定：级别',
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
    // by column letter: the field key is the hidden sheet's claim, and the
    // parser is not the thing that gets to believe it
    expect(parsed.rows[0]!.cells['C']).toBe('入伍')
    expect(parsed.rows[0]!.cells['D']).toBe('national')
    expect(parsed.rows[0]!.basis).toBe('校发〔2026〕7 号')
    expect(parsed.rows[0]!.rowNo).toBe(2)
  })

  it('declares every column of words as text, and leaves the numeric ones alone', async () => {
    const bytes = await buildAdministrativeWorkbook(
      spec({
        evidence: [
          { key: 'certificate', schema: { type: 'string', title: '证书编号' } },
          { key: 'when', schema: { type: 'string', format: 'date', title: '日期' } },
          { key: 'amount', schema: { type: 'string', format: 'qualy-decimal', title: '金额' } },
        ],
      }),
    )
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(bytes as unknown as ArrayBuffer)
    const sheet = book.getWorksheet(DATA_SHEET)!
    const formatOf = (at: number) => sheet.getColumn(at).numFmt
    // business number, name, the certificate number, the level, the basis
    expect([formatOf(1), formatOf(2), formatOf(3), formatOf(6), formatOf(7)]).toEqual([
      '@',
      '@',
      '@',
      '@',
      '@',
    ])
    // a date and an amount are read as what they are, so a recorder gets the
    // spreadsheet's own help with them
    expect(formatOf(4)).toBe(undefined)
    expect(formatOf(5)).toBe(undefined)
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
    const colliding = spec({
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
    })
    const bytes = await buildAdministrativeWorkbook(colliding)
    await parseAdministrativeWorkbook(bytes)
    expect(templateLayout(colliding).columns[1]!.choices).toEqual([
      { value: 'national', label: '国家级 [national]' },
      { value: 'national-special', label: '国家级 [national-special]' },
    ])
  })

  // A cell's text arrives trimmed, so two labels that are the same word with
  // a space around one of them are two words here and one word there. Neither
  // was disambiguated and the reading matched whichever came first, so the
  // other value was unreachable and quietly became the first - as a recorded
  // fact about a person.
  it('tells two choices apart when only a space around one of them differs', async () => {
    const spaced = spec({
      recognition: [
        {
          id: 'rec-level',
          schema: {
            type: 'string',
            enum: ['national', 'national-special'],
            'x-qualy-enumLabels': { national: '国家级', 'national-special': ' 国家级 ' },
          } as never,
        },
      ],
    })
    const bytes = await buildAdministrativeWorkbook(spaced)
    await parseAdministrativeWorkbook(bytes)
    const choices = templateLayout(spaced).columns[1]!.choices!
    expect(choices).toEqual([
      { value: 'national', label: '国家级 [national]' },
      { value: 'national-special', label: '国家级 [national-special]' },
    ])
    // and every label is one the reading can actually find: the cell is
    // trimmed before it is compared
    for (const choice of choices) expect(choice.label).toBe(choice.label.trim())
  })

  it('leaves a label alone when nothing collides with it', async () => {
    const distinct = spec({
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
    })
    const bytes = await buildAdministrativeWorkbook(distinct)
    await parseAdministrativeWorkbook(bytes)
    expect(templateLayout(distinct).columns[1]!.choices).toEqual([
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
    expect(parsed.rows[0]!.cells['C']).toBe('2026-03-01')
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

  it('holds the name and the basis to the cell ceiling like every other column', async () => {
    const template = await buildAdministrativeWorkbook(spec())
    const tooLong = 'x'.repeat(ADMIN_IMPORT_LIMITS.maxCellChars + 1)
    // the template's columns: A number, B name, C summary, D level, E basis
    for (const [row, column] of [
      [['0012340', tooLong, '入伍', 'national', '文件'], 'B'],
      [['0012340', '张三', '入伍', 'national', tooLong], 'E'],
    ] as const) {
      const refused = await parseAdministrativeWorkbook(await filled(template, [row])).catch(
        (error: unknown) => error,
      )
      expect((refused as WorkbookUnreadable).reason).toBe('cell-too-long')
      expect((refused as WorkbookUnreadable).column).toBe(column)
      expect((refused as WorkbookUnreadable).rowNo).toBe(2)
    }
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

/**
 * A zip archive written by hand, so a test can say what the directory claims
 * separately from what the data is. `declared` overrides the inflated size
 * the directory states; `flags` and `method` go into both headers as given.
 */
const archiveOf = (
  parts: readonly {
    name: string
    data: Uint8Array
    declared?: number
    method?: number
    flags?: number
  }[],
) => {
  const chunks: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const part of parts) {
    const name = Buffer.from(part.name)
    const method = part.method ?? 8
    const body = method === 8 ? zlib.deflateRawSync(part.data) : Buffer.from(part.data)
    const inflated = part.declared ?? part.data.byteLength
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(part.flags ?? 0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(body.byteLength, 18)
    local.writeUInt32LE(inflated, 22)
    local.writeUInt16LE(name.byteLength, 26)
    chunks.push(local, name, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(part.flags ?? 0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(body.byteLength, 20)
    central.writeUInt32LE(inflated, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt32LE(offset, 42)
    directory.push(central, name)
    offset += local.byteLength + name.byteLength + body.byteLength
  }
  const listing = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(parts.length, 8)
  end.writeUInt16LE(parts.length, 10)
  end.writeUInt32LE(listing.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...chunks, listing, end]))
}

const refusalOf = (run: () => void) => {
  try {
    run()
  } catch (error) {
    return error instanceof ArchiveRefused ? error.reason : error
  }
  return null
}

// Ten megabytes of zip is not ten megabytes of workbook, and the reader under
// the parser inflates whatever it is handed. So the archive answers for its
// size before the reader sees a byte of it.
describe('the archive a workbook arrives in', () => {
  const small = { maxEntries: 4, maxInflatedBytes: 64 * 1024 }

  it('lets through the workbook the template writes', async () => {
    const template = await filled(await buildAdministrativeWorkbook(spec()), [
      ['0012340', '张三', '入伍', 'national', '校发〔2026〕7 号'],
    ])
    expect(refusalOf(() => inspectArchive(template))).toBeNull()
    // and an archive written by hand, so the refusals below are about what
    // they change and not about the hand-written shape
    const plain = archiveOf([
      { name: 'a.xml', data: Buffer.alloc(1000, 0x61) },
      { name: 'b.xml', data: Buffer.from('stored as it is'), method: 0 },
    ])
    expect(refusalOf(() => inspectArchive(plain, small))).toBeNull()
  })

  it('refuses a workbook far past the row ceiling before the reader builds anything', async () => {
    // This ceiling is the only one that acts before the reader materialises
    // its object model, and that model is much larger than the xml: measured,
    // 73 MiB of sheet xml became 820 MiB of heap. So it has to refuse what
    // the row ceiling would refuse anyway, rather than let the reader find
    // out afterwards.
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('big')
    for (let row = 0; row < 2 * ADMIN_IMPORT_LIMITS.maxRows; row++) {
      sheet.addRow(
        Array.from(
          { length: ADMIN_IMPORT_LIMITS.maxColumns },
          (_, col) => `2023${String(row).padStart(6, '0')}-col${String(col)}`,
        ),
      )
    }
    const bytes = new Uint8Array(await book.xlsx.writeBuffer())
    // small enough to pass the file ceiling, which is why that one cannot do
    // this job
    expect(bytes.byteLength).toBeLessThan(ADMIN_IMPORT_LIMITS.maxFileBytes)
    expect(refusalOf(() => inspectArchive(bytes))).toBe('too-large')
  }, 60_000)

  it('refuses parts that say they add up to more than the ceiling, inflating none of them', () => {
    // a declaration alone, backed by a handful of real bytes: nothing about
    // it needs inflating to be refused
    const claimed = archiveOf([
      { name: 'xl/sharedStrings.xml', data: Buffer.from('<sst/>'), declared: 65 * 1024 },
    ])
    expect(refusalOf(() => inspectArchive(claimed, small))).toBe('too-large')
    const many = archiveOf(
      Array.from({ length: small.maxEntries + 1 }, (_, at) => ({
        name: `part-${String(at)}.xml`,
        data: Buffer.from('<x/>'),
      })),
    )
    expect(refusalOf(() => inspectArchive(many, small))).toBe('too-large')
  })

  it('refuses a part that inflates past what the directory declared for it', () => {
    // a megabyte of nothing, compressed to about a kilobyte, declared as ten
    // bytes: the sum is well under the ceiling and the data is the bomb
    const lying = archiveOf([
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(1024 * 1024), declared: 10 },
    ])
    expect(refusalOf(() => inspectArchive(lying))).toBe('too-large')
  })

  it('refuses what the reader would reinterpret rather than guess along with it', async () => {
    const template = await buildAdministrativeWorkbook(spec())
    // data before the archive: the reader shifts every offset to cope
    const prefixed = new Uint8Array([...Buffer.from('#!prepended'), ...template])
    const encrypted = archiveOf([{ name: 'a.xml', data: Buffer.from('<a/>'), flags: 0x0001 }])
    const bzip2 = archiveOf([{ name: 'a.xml', data: Buffer.from('<a/>'), method: 12 }])
    const stored = archiveOf([
      { name: 'a.xml', data: Buffer.from('<a/>'), method: 0, declared: 400 },
    ])
    for (const bytes of [prefixed, encrypted, bzip2, stored]) {
      expect(refusalOf(() => inspectArchive(bytes))).toBe('malformed')
    }
  })

  it('says so through the parser, in the words a reader is shown', async () => {
    const lying = archiveOf([
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(1024 * 1024), declared: 10 },
    ])
    const tooLarge = await parseAdministrativeWorkbook(lying).catch((error: unknown) => error)
    expect((tooLarge as WorkbookUnreadable).reason).toBe('file-too-large')
    const encrypted = archiveOf([{ name: 'a.xml', data: Buffer.from('<a/>'), flags: 0x0001 }])
    const malformed = await parseAdministrativeWorkbook(encrypted).catch((error: unknown) => error)
    expect((malformed as WorkbookUnreadable).reason).toBe('not-xlsx')
  })
})
