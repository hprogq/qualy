import ExcelJS from 'exceljs'
import { supportedLocales } from '@qualy/i18n-contract'
import { choiceLabel, displayTitle, kindOf, type AtomicSchema } from '@qualy/value-schema'
import { ArchiveRefused, inspectArchive } from './archive.ts'

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
//     memory instead of an error. The file's own size is checked first, then
//     what the archive inflates to (archive.ts), and only then is the reader
//     handed the bytes; the sheet, row, column and cell ceilings follow.

/** what a single workbook may cost before it is refused outright */
export const ADMIN_IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxRows: 2000,
  maxColumns: 128,
  maxCellChars: 4000,
  maxSheets: 8,
} as const

/**
 * 2: the hidden sheet stopped carrying what a column MEANS.
 *
 * Version 1 wrote the type and the choice labels into the file, and the
 * importer read them back as the authority on how to interpret a cell. They
 * are not: the sheet is `veryHidden`, not signed, and anyone who can fill a
 * template in can edit it. Swapping two labels there left the visible
 * workbook reading 国家级 while the import stored `provincial`, and every
 * check downstream still passed - because each of them only ever asked
 * whether the RESULT was a legal value, never whether it was the reading the
 * person saw. A version 1 file is refused rather than reinterpreted.
 */
export const TEMPLATE_VERSION = 2

/** the sheet a person fills in, and the one that says where its columns are */
export const DATA_SHEET = '行政认定'
export const META_SHEET = '_qualy'

/** where a column's value ends up once the service has judged it */
export type ColumnKind = 'evidence' | 'recognition'

/**
 * What the FILE is allowed to say: where a field was put, and nothing else.
 *
 * A person may reorder the columns they see, so the workbook has to be able
 * to say where each field ended up. That is the whole of its authority. What
 * the field is, and which stored value each word stands for, come from the
 * frozen revision on the server - see `provenColumns`.
 */
export interface ColumnPlacement {
  /** the spreadsheet column letter, so a reader can be told where to look */
  readonly column: string
  readonly kind: ColumnKind
  /** the payload field key, or the opaque recognition id */
  readonly key: string
}

export interface TemplateColumn extends ColumnPlacement {
  readonly type: ReturnType<typeof kindOf>
  /** the words at the top of the column, which is what the person read */
  readonly header: string
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
  /**
   * Which language the headings were written in, so the server can work out
   * what they should say. Not an authority over meaning either: the worst a
   * wrong one can do is fail the heading comparison and have the file sent
   * back.
   */
  readonly locale: string
  /** where the file says each field is; proven against the revision, never trusted */
  readonly columns: readonly ColumnPlacement[]
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
  /**
   * Column LETTER to the cell's text, absent when the cell is empty.
   *
   * By letter rather than by the field key the file claims for it: the key
   * is the file's word and is not established until the server has proven
   * the placement, so keying by it here would bake an unproven claim into
   * the rows themselves.
   */
  readonly cells: Readonly<Record<string, string>>
  readonly basis: string
}

export interface ParsedWorkbook {
  readonly metadata: TemplateMetadata
  /** the words at the top of each declared column, as the person read them */
  readonly headers: Readonly<Record<string, string>>
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

const BUSINESS_NO_HEADER = '学工号 *'
const NAME_HEADER = '姓名'
const BASIS_HEADER = '认定依据'

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
 * The columns a question has, worked out from the question itself.
 *
 * One function for both directions. The template is written from it, and an
 * uploaded file is proven against it - so "what this column is" has a single
 * definition rather than one that is written into a file and a second that
 * reads it back. Everything a cell's reading depends on (the type, the words
 * each stored value wears) comes from here, which means it comes from the
 * frozen revision the caller already loaded.
 */
export const templateLayout = (
  spec: Pick<TemplateSpec, 'locale' | 'evidence' | 'recognition'>,
): { readonly headers: readonly string[]; readonly columns: readonly TemplateColumn[] } => {
  const headers = [BUSINESS_NO_HEADER, NAME_HEADER]
  const columns: TemplateColumn[] = []
  for (const field of spec.evidence) {
    const header = displayTitle(field.schema, field.key, spec.locale)
    headers.push(header)
    const choices = choicesOf(field.schema, spec.locale)
    columns.push({
      column: columnLetter(headers.length),
      kind: 'evidence',
      key: field.key,
      type: kindOf(field.schema),
      header,
      ...(choices === undefined ? {} : { choices }),
    })
  }
  for (const field of spec.recognition) {
    const header = `认定：${displayTitle(field.schema, field.id, spec.locale)}`
    headers.push(header)
    const choices = choicesOf(field.schema, spec.locale)
    columns.push({
      column: columnLetter(headers.length),
      kind: 'recognition',
      key: field.id,
      type: kindOf(field.schema),
      header,
      ...(choices === undefined ? {} : { choices }),
    })
  }
  headers.push(BASIS_HEADER)
  return { headers, columns }
}

/**
 * The workbook a recorder downloads: the two identity columns, then the
 * question's own fields, then what the office determines, then the basis.
 */
export const buildAdministrativeWorkbook = async (spec: TemplateSpec): Promise<Uint8Array> => {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet(DATA_SHEET)
  const { headers, columns } = templateLayout(spec)
  sheet.addRow([...headers])
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
    locale: spec.locale,
    // placements only. Anyone who can fill this in can edit this sheet, so
    // the most it is allowed to decide is WHERE a field is - and even that
    // is proven against the header the person read before it is believed.
    columns: columns.map(({ column, kind, key }) => ({ column, kind, key })),
  }
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
export const parseAdministrativeWorkbook = async (bytes: Uint8Array): Promise<ParsedWorkbook> => {
  if (bytes.byteLength > ADMIN_IMPORT_LIMITS.maxFileBytes) {
    throw new WorkbookUnreadable('file-too-large')
  }
  // the size of the file is not the size of the workbook: what it inflates
  // to is found out before the reader inflates any of it
  try {
    inspectArchive(bytes)
  } catch (error) {
    if (!(error instanceof ArchiveRefused)) throw error
    throw new WorkbookUnreadable(error.reason === 'too-large' ? 'file-too-large' : 'not-xlsx')
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
    !supportedLocales.includes(metadata.locale as never) ||
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
  // The placements, held to being placements at all: a letter this module
  // will address a cell by, inside the sheet's own ceiling, one field per
  // column and one column per field. None of this says the placement is the
  // RIGHT one - that is proven against the question - but a letter like
  // `A1:ZZ9` or a field claimed twice is malformed rather than mistaken.
  const seenColumns = new Set<string>()
  const seenKeys = new Set<string>()
  for (const placement of metadata.columns) {
    if (
      placement === null ||
      typeof placement !== 'object' ||
      typeof placement.column !== 'string' ||
      typeof placement.key !== 'string' ||
      (placement.kind !== 'evidence' && placement.kind !== 'recognition')
    ) {
      throw new WorkbookUnreadable('metadata-corrupt')
    }
    if (!/^[A-Z]{1,3}$/.test(placement.column)) throw new WorkbookUnreadable('metadata-corrupt')
    if (columnIndex(placement.column) > ADMIN_IMPORT_LIMITS.maxColumns) {
      throw new WorkbookUnreadable('too-many-columns')
    }
    const field = `${placement.kind}.${placement.key}`
    if (seenColumns.has(placement.column) || seenKeys.has(field)) {
      throw new WorkbookUnreadable('metadata-corrupt')
    }
    seenColumns.add(placement.column)
    seenKeys.add(field)
  }

  const sheet = book.getWorksheet(DATA_SHEET)
  if (sheet === undefined) throw new WorkbookUnreadable('data-sheet-missing')
  if (sheet.columnCount > ADMIN_IMPORT_LIMITS.maxColumns) {
    throw new WorkbookUnreadable('too-many-columns')
  }
  // How far the sheet REACHES, not how much of it is filled in. The ceiling
  // below counts rows that hold something, which a file can satisfy with two
  // of them while declaring a cell at row 1,048,576 - and the walk would
  // still visit every row in between, a million synchronous reads for two
  // rows of data. A template is a contiguous table, so a sheet that reaches
  // past the ceiling is refused before a single row is read.
  if (sheet.rowCount > ADMIN_IMPORT_LIMITS.maxRows + 1) {
    throw new WorkbookUnreadable('too-many-rows')
  }

  // Every cell this reads is held to the same ceiling, the identity and basis
  // columns included: they are text somebody typed like any other, and the
  // ceiling is about what a file may cost, not about what a column means.
  // How wide each one may be once written is the domain's question, asked
  // row by row where the reader is told which row to fix.
  const at = (row: ExcelJS.Row, letter: string, rowNo: number) => {
    const text = textOf(row.getCell(letter), rowNo).trim()
    if (text.length > ADMIN_IMPORT_LIMITS.maxCellChars) {
      throw new WorkbookUnreadable('cell-too-long', { rowNo, column: letter })
    }
    return text
  }
  // the basis is whatever sits after the declared columns, which is where
  // the template put it
  const basisColumn = columnLetter(metadata.columns.length + 3)

  // The words at the top of each declared column. They are what the person
  // filling the file in actually read, which is what makes them the anchor
  // the server proves a placement against: a hidden sheet that moves a field
  // onto another column has to move the visible heading too, and then the
  // document says what it does.
  const headerRow = sheet.getRow(1)
  const headers: Record<string, string> = Object.create(null)
  for (const placement of metadata.columns) {
    headers[placement.column] = at(headerRow, placement.column, 1)
  }

  const rows: RawRow[] = []
  for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo)
    const businessNo = at(row, 'A', rowNo)
    const displayName = at(row, 'B', rowNo)
    const cells: Record<string, string> = Object.create(null)
    let anything = businessNo !== '' || displayName !== ''
    for (const placement of metadata.columns) {
      const text = at(row, placement.column, rowNo)
      if (text !== '') {
        cells[placement.column] = text
        anything = true
      }
    }
    const basis = at(row, basisColumn, rowNo)
    if (basis !== '') anything = true
    // a workbook saved by a spreadsheet carries a tail of rows that look
    // real to the reader and are empty to a person; they are not rows
    if (!anything) continue
    rows.push({ rowNo, businessNo, displayName, cells, basis })
    if (rows.length > ADMIN_IMPORT_LIMITS.maxRows) {
      throw new WorkbookUnreadable('too-many-rows')
    }
  }

  return { metadata, headers, rows }
}
