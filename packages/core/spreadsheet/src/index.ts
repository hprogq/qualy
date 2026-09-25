import ExcelJS from 'exceljs'
import { ArchiveRefused, inspectArchive, type ArchiveLimits } from './archive.ts'
import { IGNORED_NODES, type ContentLimits } from './contents.ts'

// Bytes in, cell text out - and nothing about what any of it means.
//
// The one spreadsheet engine every importer shares: the archive guard, the
// resource ceilings, the reader that refuses a formula, and the letters a
// column is addressed by. What a sheet's columns MEAN - a question's fields,
// a person's identifier - is each importer's own protocol, kept beside the
// importer; this module never reads a header as anything but words.
//
// Two rules it does enforce, because they are about the FILE rather than
// about any domain:
//
//   - a formula cell is refused outright. The library hands back the cached
//     result beside the formula rather than evaluating it, so nothing here
//     executes anything; but a cached result is whatever was last saved,
//     which is not a fact anybody signed.
//   - the resource limits, so a hostile workbook cannot be answered with
//     memory instead of an error. The file's own size is checked first, then
//     what the archive inflates to (archive.ts) and what its parts would
//     become (contents.ts), and only then is the reader handed the bytes; the
//     sheet, row, column and cell ceilings of what was read follow. How many
//     workbooks are read at once is gate.ts.

export { ArchiveRefused, ARCHIVE_LIMITS, inspectArchive, type ArchiveLimits } from './archive.ts'
export { type ContentLimits } from './contents.ts'
export { readWorkbook } from './gate.ts'

/** what a single workbook may cost before it is refused outright */
export interface SpreadsheetLimits {
  readonly maxFileBytes: number
  readonly maxRows: number
  readonly maxColumns: number
  readonly maxCellChars: number
  readonly maxSheets: number
}

export const SPREADSHEET_LIMITS: SpreadsheetLimits = {
  maxFileBytes: 10 * 1024 * 1024,
  maxRows: 2000,
  maxColumns: 128,
  maxCellChars: 4000,
  maxSheets: 8,
}

/** what the rest of the workbook may add besides its cells: styles, the workbook, drawings, comments */
const FURNITURE = 65_536

/**
 * The ceilings on what a workbook's parts may hold, from the ceilings on what
 * the parser accepts: every sheet together holds no more cells than the one
 * widest table the parser would read, and no more rows than every sheet at
 * its longest. The cells are the ceiling on the reader's heap, so they are
 * counted across sheets: a workbook of several full sheets is refused as
 * `too-many-cells`, which a person answers by keeping the one sheet they
 * import.
 */
export const contentLimitsOf = (limits: SpreadsheetLimits): ContentLimits => {
  const cells = (limits.maxRows + 1) * limits.maxColumns
  return {
    maxSheets: limits.maxSheets,
    maxRows: limits.maxSheets * (limits.maxRows + 1),
    maxCells: cells,
    maxMerges: 2 * (limits.maxRows + 1),
    // a value for each cell, and the sheet's own furniture
    maxSheetElements: cells + FURNITURE,
    maxSharedStrings: cells,
    // the text inside each entry
    maxSharedElements: cells + FURNITURE,
    maxOtherElements: FURNITURE,
  }
}

/** why a file, a sheet or a cell was not read, in one stable word */
export type SpreadsheetRefusal =
  | 'file-too-large'
  | 'not-xlsx'
  | 'too-many-sheets'
  | 'sheet-missing'
  | 'too-many-rows'
  | 'too-many-cells'
  | 'too-many-columns'
  | 'cell-too-long'
  | 'formula-not-allowed'
  | 'cell-error'
  | 'header-row-out-of-range'

/** a workbook this module will not read, said in one word and, where it can, a place */
export class SpreadsheetUnreadable extends Error {
  readonly reason: SpreadsheetRefusal
  readonly rowNo: number | null
  readonly column: string | null
  constructor(reason: SpreadsheetRefusal, where?: { rowNo?: number; column?: string }) {
    super(reason)
    this.name = 'SpreadsheetUnreadable'
    this.reason = reason
    this.rowNo = where?.rowNo ?? null
    this.column = where?.column ?? null
  }
}

/** the 1-based column index a spreadsheet letter names */
export const columnIndex = (letter: string): number => {
  let n = 0
  for (const character of letter) n = n * 26 + (character.charCodeAt(0) - 64)
  return n
}

/** the spreadsheet letter for a 1-based column index */
export const columnLetter = (index: number): string => {
  let n = index
  let out = ''
  while (n > 0) {
    const rest = (n - 1) % 26
    out = String.fromCharCode(65 + rest) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** the letters of a cell address: `AB12` -> `AB` */
const lettersOf = (address: string) => address.replace(/\d+/g, '')

/** the text of a cell, refusing the shapes no importer will interpret */
export const cellText = (cell: ExcelJS.Cell, rowNo: number): string => {
  const value = cell.value
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) {
    // a date cell, normalised to the calendar day the file shows rather than
    // to an instant: a serial date read as an instant drifts by a timezone
    const y = value.getUTCFullYear()
    const m = String(value.getUTCMonth() + 1).padStart(2, '0')
    const d = String(value.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      // the library hands back the cached result rather than running
      // anything, and a cached result is whatever was last saved by
      // whatever opened the file - not a fact anybody signed
      throw new SpreadsheetUnreadable('formula-not-allowed', {
        rowNo,
        column: lettersOf(cell.address),
      })
    }
    if ('richText' in value) {
      return (value.richText as readonly { text: string }[]).map((part) => part.text).join('')
    }
    if ('text' in value) return String((value as { text: unknown }).text)
    if ('error' in value) {
      throw new SpreadsheetUnreadable('cell-error', { rowNo, column: lettersOf(cell.address) })
    }
  }
  return String(value)
}

const ARCHIVE_REFUSALS = {
  malformed: 'not-xlsx',
  'too-large': 'file-too-large',
  'too-many-sheets': 'too-many-sheets',
  'too-many-rows': 'too-many-rows',
  'too-many-cells': 'too-many-cells',
} as const satisfies Record<ArchiveRefused['reason'], SpreadsheetRefusal>

/**
 * A workbook opened under the ceilings: the file's size, what the archive
 * inflates to and what its parts hold, then the reader, then the sheet count.
 *
 * Callers on a server read it through `readWorkbook`, which holds the
 * process's one permit while the reader works.
 */
export const openWorkbook = async (
  bytes: Uint8Array,
  limits: SpreadsheetLimits = SPREADSHEET_LIMITS,
  archive?: ArchiveLimits,
): Promise<ExcelJS.Workbook> => {
  if (bytes.byteLength > limits.maxFileBytes) throw new SpreadsheetUnreadable('file-too-large')
  try {
    inspectArchive(bytes, archive, contentLimitsOf(limits))
  } catch (error) {
    if (!(error instanceof ArchiveRefused)) throw error
    throw new SpreadsheetUnreadable(ARCHIVE_REFUSALS[error.reason])
  }
  const book = new ExcelJS.Workbook()
  try {
    await book.xlsx.load(bytes as unknown as ArrayBuffer, { ignoreNodes: [...IGNORED_NODES] })
  } catch {
    throw new SpreadsheetUnreadable('not-xlsx')
  }
  if (book.worksheets.length > limits.maxSheets) {
    throw new SpreadsheetUnreadable('too-many-sheets')
  }
  return book
}

/** one sheet, as a picker lists it */
export interface SheetSummary {
  readonly name: string
  /** how far the sheet reaches, which is not how much of it is filled in */
  readonly rowCount: number
  readonly columnCount: number
}

export const sheetsOf = (book: ExcelJS.Workbook): readonly SheetSummary[] =>
  book.worksheets.map((sheet) => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
  }))

export interface TableHeader {
  readonly column: string
  readonly text: string
}

export interface TableRow {
  /** the spreadsheet row number, so an issue can name where to look */
  readonly rowNo: number
  /** column letter to the cell's trimmed text; absent when the cell is empty */
  readonly cells: Readonly<Record<string, string>>
}

export interface SheetTable {
  readonly sheet: string
  readonly headerRow: number
  readonly headers: readonly TableHeader[]
  readonly rows: readonly TableRow[]
}

/**
 * A sheet read as a table: the words on the header row, then every row
 * under it that holds anything, cell by cell, under the ceilings.
 *
 * A trailing run of empty rows is not rows: a workbook saved by a
 * spreadsheet carries a tail that looks real to the reader and is empty to
 * a person.
 */
export const readTable = (
  book: ExcelJS.Workbook,
  sheetName: string,
  options: { readonly headerRow: number; readonly limits?: SpreadsheetLimits },
): SheetTable => {
  const limits = options.limits ?? SPREADSHEET_LIMITS
  const sheet = book.getWorksheet(sheetName)
  if (sheet === undefined) throw new SpreadsheetUnreadable('sheet-missing')
  if (sheet.columnCount > limits.maxColumns) throw new SpreadsheetUnreadable('too-many-columns')
  if (!Number.isInteger(options.headerRow) || options.headerRow < 1) {
    throw new SpreadsheetUnreadable('header-row-out-of-range')
  }
  // how far the sheet REACHES: a sheet declaring a cell at row 1,048,576 is
  // a million synchronous reads whatever it holds, so it is refused before
  // a single row is read
  if (sheet.rowCount > options.headerRow + limits.maxRows) {
    throw new SpreadsheetUnreadable('too-many-rows')
  }
  if (options.headerRow > sheet.rowCount) {
    throw new SpreadsheetUnreadable('header-row-out-of-range')
  }
  const at = (row: ExcelJS.Row, letter: string, rowNo: number) => {
    const text = cellText(row.getCell(letter), rowNo).trim()
    if (text.length > limits.maxCellChars) {
      throw new SpreadsheetUnreadable('cell-too-long', { rowNo, column: letter })
    }
    return text
  }
  const width = Math.min(sheet.columnCount, limits.maxColumns)
  const letters = Array.from({ length: width }, (_, index) => columnLetter(index + 1))
  const headerRow = sheet.getRow(options.headerRow)
  const headers: TableHeader[] = []
  for (const letter of letters) {
    const text = at(headerRow, letter, options.headerRow)
    if (text !== '') headers.push({ column: letter, text })
  }
  const rows: TableRow[] = []
  for (let rowNo = options.headerRow + 1; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo)
    const cells: Record<string, string> = Object.create(null)
    let anything = false
    for (const letter of letters) {
      const text = at(row, letter, rowNo)
      if (text !== '') {
        cells[letter] = text
        anything = true
      }
    }
    if (!anything) continue
    rows.push({ rowNo, cells })
    if (rows.length > limits.maxRows) throw new SpreadsheetUnreadable('too-many-rows')
  }
  return { sheet: sheet.name, headerRow: options.headerRow, headers, rows }
}
