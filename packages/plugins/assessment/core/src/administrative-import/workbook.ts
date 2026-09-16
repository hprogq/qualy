import ExcelJS from 'exceljs'
import { choiceLabel, displayTitle, kindOf, type AtomicSchema } from '@qualy/value-schema'

// Bytes in, typed rows out - and nothing else.
//
// This module does not know what a batch is, who is asking, or what any of
// the values mean. It reads a workbook into a shape the service can judge,
// and writes a template from a shape the service hands it. That is what
// makes the Excel edge cases - a merged cell, a formula, a blank tail, a
// leading zero eaten by Excel - coverable by a plain unit test instead of a
// round trip through the database.
//
// Two rules it does enforce, because they are about the FILE rather than
// about the domain:
//
//   - a formula cell is refused outright. The library hands back the cached
//     result beside the formula rather than evaluating it, so nothing here
//     executes anything; but a cached result is whatever was last saved,
//     which is not a fact anybody signed.
//   - the resource limits, so a hostile workbook cannot be answered with
//     memory instead of an error.

/** what a single workbook may cost before it is refused outright */
export const ADMIN_IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxRows: 2000,
  maxColumns: 128,
  maxCellChars: 4000,
  maxSheets: 8,
} as const

export const TEMPLATE_VERSION = 1

/** the sheet a person fills in, and the one that says what its columns mean */
export const DATA_SHEET = '行政认定'
export const META_SHEET = '_qualy'

/** where a column's value ends up once the service has judged it */
export type ColumnKind = 'evidence' | 'recognition'

export interface TemplateColumn {
  /** the spreadsheet column letter, so a reader can be told where to look */
  readonly column: string
  readonly kind: ColumnKind
  /** the payload field key, or the opaque recognition id */
  readonly key: string
  readonly type: ReturnType<typeof kindOf>
  /**
   * The stable value behind each label a person sees.
   *
   * A workbook shows words; the contract stores values. Where two values
   * carry the same label the template disambiguates, so the mapping stays
   * reversible - otherwise "国家级" could mean either of two things and the
   * file would have destroyed the difference.
   */
  readonly choices?: readonly { readonly label: string; readonly value: string }[]
}

export interface TemplateMetadata {
  readonly templateVersion: number
  readonly batchId: string
  readonly itemId: string
  readonly itemRevisionId: string
  readonly columns: readonly TemplateColumn[]
}

/** what the service asks for when it builds a template */
export interface TemplateSpec {
  readonly batchId: string
  readonly itemId: string
  readonly itemRevisionId: string
  readonly itemTitle: string
  readonly locale: string
  readonly evidence: readonly { readonly key: string; readonly schema: AtomicSchema }[]
  readonly recognition: readonly { readonly id: string; readonly schema: AtomicSchema }[]
}

/** one row as the file has it, before anything domain-shaped is decided */
export interface RawRow {
  /** the spreadsheet row number, so an issue can name where to look */
  readonly rowNo: number
  readonly businessNo: string
  readonly displayName: string
  /** column key to the cell's text, absent when the cell is empty */
  readonly cells: Readonly<Record<string, string>>
  readonly basis: string
}

export interface ParsedWorkbook {
  readonly metadata: TemplateMetadata
  readonly rows: readonly RawRow[]
}

/** a workbook this module will not read, said in one word */
export class WorkbookUnreadable extends Error {
  readonly reason: string
  readonly rowNo: number | null
  readonly column: string | null
  constructor(reason: string, where?: { rowNo?: number; column?: string }) {
    super(reason)
    this.name = 'WorkbookUnreadable'
    this.reason = reason
    this.rowNo = where?.rowNo ?? null
    this.column = where?.column ?? null
  }
}

const BUSINESS_NO_HEADER = '业务编号 *'
const NAME_HEADER = '姓名'
const BASIS_HEADER = '认定依据'

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

/** the labels a choice schema offers, disambiguated where two collide */
const choicesOf = (schema: AtomicSchema, locale: string) => {
  if (kindOf(schema) !== 'choice') return undefined
  const values = (schema as { enum: readonly string[] }).enum
  const labels = values.map((value) => choiceLabel(schema as never, value, locale))
  const seen = new Map<string, number>()
  for (const label of labels) seen.set(label, (seen.get(label) ?? 0) + 1)
  return values.map((value, at) => {
    const label = labels[at]!
    // two values, one word: the file has to keep them apart or importing it
    // back would have to guess
    return { value, label: (seen.get(label) ?? 0) > 1 ? `${label} [${value}]` : label }
  })
}

/**
 * The workbook a recorder downloads: the two identity columns, then the
 * question's own fields, then what the office determines, then the basis.
 */
export const buildAdministrativeWorkbook = async (spec: TemplateSpec): Promise<Uint8Array> => {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet(DATA_SHEET)
  const headers = [BUSINESS_NO_HEADER, NAME_HEADER]
  const columns: TemplateColumn[] = []
  for (const field of spec.evidence) {
    headers.push(displayTitle(field.schema, field.key, spec.locale))
    const choices = choicesOf(field.schema, spec.locale)
    columns.push({
      column: columnLetter(headers.length),
      kind: 'evidence',
      key: field.key,
      type: kindOf(field.schema),
      ...(choices === undefined ? {} : { choices }),
    })
  }
  for (const field of spec.recognition) {
    headers.push(`认定：${displayTitle(field.schema, field.id, spec.locale)}`)
    const choices = choicesOf(field.schema, spec.locale)
    columns.push({
      column: columnLetter(headers.length),
      kind: 'recognition',
      key: field.id,
      type: kindOf(field.schema),
      ...(choices === undefined ? {} : { choices }),
    })
  }
  headers.push(BASIS_HEADER)
  sheet.addRow(headers)
  sheet.getRow(1).font = { bold: true }
  // the identity column is text, or Excel turns 0012340 into 12340 the
  // moment somebody opens the file
  sheet.getColumn(1).numFmt = '@'
  sheet.getColumn(1).width = 18
  sheet.getColumn(2).width = 12
  for (let at = 3; at <= headers.length; at += 1) sheet.getColumn(at).width = 20

  const metadata: TemplateMetadata = {
    templateVersion: TEMPLATE_VERSION,
    batchId: spec.batchId,
    itemId: spec.itemId,
    itemRevisionId: spec.itemRevisionId,
    columns,
  }
  // Not a credential: the server revalidates the batch, the item, the
  // revision, the caller's authority and every value. This only keeps a
  // template from being filled in against the wrong question and keeps the
  // column mapping stable when somebody reorders what they see.
  const meta = book.addWorksheet(META_SHEET)
  meta.state = 'veryHidden'
  meta.addRow([JSON.stringify(metadata)])

  const bytes = await book.xlsx.writeBuffer()
  return new Uint8Array(bytes as ArrayBuffer)
}

/** the text of a cell, refusing the shapes this importer will not interpret */
const textOf = (cell: ExcelJS.Cell, rowNo: number): string => {
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
      throw new WorkbookUnreadable('formula-not-allowed', {
        rowNo,
        column: cell.address.replace(/\d+/g, ''),
      })
    }
    if ('richText' in value) {
      return (value.richText as readonly { text: string }[]).map((part) => part.text).join('')
    }
    if ('text' in value) return String((value as { text: unknown }).text)
    if ('error' in value) {
      throw new WorkbookUnreadable('cell-error', {
        rowNo,
        column: cell.address.replace(/\d+/g, ''),
      })
    }
  }
  return String(value)
}

/**
 * The file, read.
 *
 * Structure only: which columns the template declared, and what each row
 * says in each of them. Whether a business number names anybody, whether a
 * value fits its schema, whether the caller may record on that person -
 * none of that is answerable here, and pretending otherwise is what turns a
 * parser into a second copy of the domain.
 */
export const parseAdministrativeWorkbook = async (
  bytes: Uint8Array,
): Promise<ParsedWorkbook> => {
  if (bytes.byteLength > ADMIN_IMPORT_LIMITS.maxFileBytes) {
    throw new WorkbookUnreadable('file-too-large')
  }
  const book = new ExcelJS.Workbook()
  try {
    await book.xlsx.load(bytes as unknown as ArrayBuffer)
  } catch {
    throw new WorkbookUnreadable('not-xlsx')
  }
  if (book.worksheets.length > ADMIN_IMPORT_LIMITS.maxSheets) {
    throw new WorkbookUnreadable('too-many-sheets')
  }

  const metaSheet = book.getWorksheet(META_SHEET)
  if (metaSheet === undefined) throw new WorkbookUnreadable('metadata-missing')
  const rawMeta = metaSheet.getRow(1).getCell(1).value
  let metadata: TemplateMetadata
  try {
    metadata = JSON.parse(typeof rawMeta === 'string' ? rawMeta : String(rawMeta ?? ''))
  } catch {
    throw new WorkbookUnreadable('metadata-corrupt')
  }
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    typeof metadata.batchId !== 'string' ||
    typeof metadata.itemId !== 'string' ||
    typeof metadata.itemRevisionId !== 'string' ||
    !Array.isArray(metadata.columns)
  ) {
    throw new WorkbookUnreadable('metadata-corrupt')
  }
  if (metadata.templateVersion !== TEMPLATE_VERSION) {
    throw new WorkbookUnreadable('unsupported-template-version')
  }
  if (metadata.columns.length + 3 > ADMIN_IMPORT_LIMITS.maxColumns) {
    throw new WorkbookUnreadable('too-many-columns')
  }

  const sheet = book.getWorksheet(DATA_SHEET)
  if (sheet === undefined) throw new WorkbookUnreadable('data-sheet-missing')
  if (sheet.columnCount > ADMIN_IMPORT_LIMITS.maxColumns) {
    throw new WorkbookUnreadable('too-many-columns')
  }

  const at = (row: ExcelJS.Row, letter: string, rowNo: number) =>
    textOf(row.getCell(letter), rowNo).trim()
  // the basis is whatever sits after the declared columns, which is where
  // the template put it
  const basisColumn = columnLetter(metadata.columns.length + 3)

  const rows: RawRow[] = []
  let blankTail = 0
  for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo)
    const businessNo = at(row, 'A', rowNo)
    const displayName = at(row, 'B', rowNo)
    const cells: Record<string, string> = Object.create(null)
    let anything = businessNo !== '' || displayName !== ''
    for (const column of metadata.columns) {
      const text = at(row, column.column, rowNo)
      if (text.length > ADMIN_IMPORT_LIMITS.maxCellChars) {
        throw new WorkbookUnreadable('cell-too-long', { rowNo, column: column.column })
      }
      if (text !== '') {
        cells[column.key] = text
        anything = true
      }
    }
    const basis = at(row, basisColumn, rowNo)
    if (basis !== '') anything = true
    // a workbook saved by a spreadsheet carries a tail of rows that look
    // real to the reader and are empty to a person; they are not rows
    if (!anything) {
      blankTail += 1
      continue
    }
    blankTail = 0
    rows.push({ rowNo, businessNo, displayName, cells, basis })
    if (rows.length > ADMIN_IMPORT_LIMITS.maxRows) {
      throw new WorkbookUnreadable('too-many-rows')
    }
  }
  void blankTail

  return { metadata, rows }
}
