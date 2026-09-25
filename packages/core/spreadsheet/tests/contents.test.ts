import zlib from 'node:zlib'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { ArchiveRefused, ARCHIVE_LIMITS, inspectArchive } from '../src/archive.ts'
import { cellsIn } from '../src/contents.ts'
import {
  contentLimitsOf,
  openWorkbook,
  readTable,
  SPREADSHEET_LIMITS,
  SpreadsheetUnreadable,
} from '../src/index.ts'

// What a workbook becomes once the reader has built it, refused before it is
// built. Each case below is a file far smaller than the archive ceiling that
// the reader would have turned into hundreds of megabytes, or into a loop
// over the whole grid; the refusal has to come from inspectArchive, which
// never calls the reader, so that is where it is asserted.

const CONTENTS = contentLimitsOf(SPREADSHEET_LIMITS)

/** a zip written by hand, so a part can say exactly what a hostile file would */
const archiveOf = (
  parts: readonly { name: string; data: string | Buffer; unicodePath?: string }[],
): Uint8Array => {
  const chunks: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const part of parts) {
    const name = Buffer.from(part.name)
    const data = Buffer.from(part.data)
    const body = zlib.deflateRawSync(data)
    const extra =
      part.unicodePath === undefined
        ? Buffer.alloc(0)
        : (() => {
            const path = Buffer.from(part.unicodePath)
            const field = Buffer.alloc(9 + path.byteLength)
            field.writeUInt16LE(0x7075, 0)
            field.writeUInt16LE(5 + path.byteLength, 2)
            field.writeUInt8(1, 4)
            field.writeUInt32LE(zlib.crc32(name), 5)
            path.copy(field, 9)
            return field
          })()
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(zlib.crc32(data), 14)
    local.writeUInt32LE(body.byteLength, 18)
    local.writeUInt32LE(data.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    chunks.push(local, name, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(zlib.crc32(data), 16)
    central.writeUInt32LE(body.byteLength, 20)
    central.writeUInt32LE(data.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt16LE(extra.byteLength, 30)
    central.writeUInt32LE(offset, 42)
    directory.push(central, name, extra)
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

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** the smallest package the reader opens: one sheet, one cell, and whatever the case adds */
const workbookOf = (
  options: { sheet?: string; afterData?: string; rows?: string; definedNames?: string } = {},
) =>
  archiveOf([
    {
      name: '_rels/.rels',
      data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets>${options.definedNames ?? ''}</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: options.sheet ?? 'xl/worksheets/sheet1.xml',
      data: `<worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>名字</t></is></c></row>${options.rows ?? ''}</sheetData>${options.afterData ?? ''}</worksheet>`,
    },
  ])

const refusalOf = (bytes: Uint8Array) => {
  try {
    inspectArchive(bytes, ARCHIVE_LIMITS, CONTENTS)
  } catch (error) {
    if (error instanceof ArchiveRefused) return error.reason
    throw error
  }
  return null
}

const numericBook = async (rows: number, columns: number) => {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('s')
  for (let row = 0; row < rows; row++) {
    sheet.addRow(Array.from({ length: columns }, (_, column) => row * columns + column))
  }
  return new Uint8Array(await book.xlsx.writeBuffer())
}

describe('what a workbook would become, counted before the reader builds it', () => {
  it('opens the widest table the parser reads', async () => {
    const bytes = await numericBook(SPREADSHEET_LIMITS.maxRows + 1, SPREADSHEET_LIMITS.maxColumns)
    expect(refusalOf(bytes)).toBeNull()
    const table = readTable(await openWorkbook(bytes), 's', { headerRow: 1 })
    expect(table.rows).toHaveLength(SPREADSHEET_LIMITS.maxRows)
  }, 60_000)

  it('refuses a small file of numbers holding four times the rows, before reading it', async () => {
    // numbers are short in xml: this passes both the file and the archive
    // ceiling, and the reader would have spent about 400 MiB building it
    const bytes = await numericBook(4 * SPREADSHEET_LIMITS.maxRows, SPREADSHEET_LIMITS.maxColumns)
    expect(bytes.byteLength).toBeLessThan(SPREADSHEET_LIMITS.maxFileBytes)
    expect(() => inspectArchive(bytes)).not.toThrow()
    expect(refusalOf(bytes)).toBe('too-many-cells')
    const refused = await openWorkbook(bytes).catch((error: unknown) => error)
    expect((refused as SpreadsheetUnreadable).reason).toBe('too-many-cells')
  }, 60_000)

  // The cells are counted across sheets, because the reader builds every
  // sheet whichever one is imported. A small file of several ordinary sheets
  // was refused as too large, which told nobody to take the other sheets out.
  it('says a workbook of several sheets holds too many cells, not that the file is too large', () => {
    const rows = (sheet: number) =>
      Array.from(
        { length: SPREADSHEET_LIMITS.maxRows },
        (_, at) =>
          `<row r="${String(at + 2)}">${Array.from(
            { length: 40 },
            (_, column) => `<c r="${String(sheet)}${String(column)}"><v>1</v></c>`,
          ).join('')}</row>`,
      ).join('')
    const sheets = [1, 2, 3, 4].map((sheet) => ({
      name: `xl/worksheets/sheet${String(sheet)}.xml`,
      data: `<worksheet xmlns="${NS}"><sheetData>${rows(sheet)}</sheetData></worksheet>`,
    }))
    const bytes = archiveOf(sheets)
    expect(bytes.byteLength).toBeLessThan(SPREADSHEET_LIMITS.maxFileBytes)
    expect(refusalOf(bytes)).toBe('too-many-cells')
    // and any one of them alone is an ordinary sheet
    expect(refusalOf(archiveOf(sheets.slice(0, 1)))).toBeNull()
  })

  it('refuses more rows than every sheet at its longest', () => {
    const rows = Array.from(
      { length: CONTENTS.maxRows },
      (_, at) => `<row r="${String(at + 2)}"/>`,
    ).join('')
    expect(refusalOf(workbookOf({ rows }))).toBe('too-many-rows')
  })

  it('refuses more sheets than the parser reads', () => {
    const extra = Array.from({ length: SPREADSHEET_LIMITS.maxSheets }, (_, at) => ({
      name: `xl/worksheets/sheet${String(at + 2)}.xml`,
      data: `<worksheet xmlns="${NS}"><sheetData/></worksheet>`,
    }))
    const bytes = archiveOf([{ name: 'xl/worksheets/sheet1.xml', data: '<worksheet/>' }, ...extra])
    expect(refusalOf(bytes)).toBe('too-many-sheets')
  })

  it('counts a merged range as every cell the reader creates for it', () => {
    // one element, sixteen billion cells
    expect(
      refusalOf(
        workbookOf({ afterData: '<mergeCells><mergeCell ref="A1:XFD1048576"/></mergeCells>' }),
      ),
    ).toBe('too-large')
    // written the ways a parser still reads as the same range
    for (const ref of [
      `ref="A1:&#88;FD1048576"`,
      `x=">" ref='A1:XFD1048576'`,
      `ref="$A$1:$XFD$1048576"`,
      `ref="1:1048576"`,
    ]) {
      expect(
        refusalOf(workbookOf({ afterData: `<mergeCells><mergeCell ${ref}/></mergeCells>` })),
      ).toBe('too-large')
    }
    // an ordinary merge is an ordinary file
    expect(
      refusalOf(workbookOf({ afterData: '<mergeCells><mergeCell ref="A1:A3"/></mergeCells>' })),
    ).toBeNull()
  })

  it('refuses more merged ranges than it takes to check each against the others', () => {
    const merges = Array.from(
      { length: CONTENTS.maxMerges + 1 },
      (_, at) => `<mergeCell ref="B${String(at + 1)}:C${String(at + 1)}"/>`,
    ).join('')
    expect(refusalOf(workbookOf({ afterData: `<mergeCells>${merges}</mergeCells>` }))).toBe(
      'too-large',
    )
  })

  it('counts a defined name as every cell the reader expands it to, except a print area', () => {
    const named = (name: string, text: string) =>
      workbookOf({
        definedNames: `<definedNames><definedName name="${name}">${text}</definedName></definedNames>`,
      })
    expect(refusalOf(named('everything', 's!$A$1:$XFD$1048576'))).toBe('too-large')
    expect(refusalOf(named('everything', 's!$A$1:<!-- -->$XFD$1048576'))).toBe('too-large')
    expect(refusalOf(named('_xlnm.Print_Area', 's!$A$1:$XFD$1048576'))).toBeNull()
    expect(refusalOf(named('list', 's!$A$1:$A$20'))).toBeNull()
  })

  it('refuses a part named twice, by the name the reader would believe', () => {
    const bytes = archiveOf([
      { name: 'notes.txt', data: '<x/>', unicodePath: 'xl/worksheets/sheet9.xml' },
    ])
    expect(refusalOf(bytes)).toBe('malformed')
  })

  it('reads what the cells say without expanding what no importer reads', async () => {
    // a validation over the whole grid and a column definition two billion
    // wide: each alone would keep the reader looping for minutes
    const bytes = workbookOf({
      afterData:
        '<cols><col min="1" max="2000000000" width="9"/></cols><dataValidations count="1"><dataValidation type="list" sqref="A1:XFD1048576"><formula1>"a,b"</formula1></dataValidation></dataValidations>',
    })
    const table = readTable(await openWorkbook(bytes), 's', { headerRow: 1 })
    expect(table.headers).toEqual([{ column: 'A', text: '名字' }])
  })

  it('reads a range the way the reader does', () => {
    expect(cellsIn('A1:B3')).toBe(6)
    expect(cellsIn('$B$3:$A$1')).toBe(6)
    expect(cellsIn("'a,b'!$A$1:$C$1")).toBe(3)
    expect(cellsIn('C7')).toBe(1)
    // whole rows: the reader defaults the missing columns to the first one
    expect(cellsIn('2:11')).toBe(10)
    // past the last column the reader throws, and expands nothing
    expect(cellsIn('A1:XFE9')).toBe(0)
    expect(cellsIn('s!#REF!')).toBe(0)
  })
})
