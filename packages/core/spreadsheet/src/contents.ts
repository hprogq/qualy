import { ArchiveRefused } from './refused.ts'

// What a workbook becomes once it is opened, counted before it is.
//
// The archive ceiling (archive.ts) bounds how much XML the reader is handed.
// It does not bound what that XML turns into: the reader (ExcelJS) builds an
// object for every row, every cell and every shared string, about three
// hundred bytes of heap for a cell written in a dozen, and it expands two
// structures cell by cell from a range a file writes in a few bytes - a
// merged range and a defined name. A sheet of eight thousand numeric rows
// passes the archive ceiling and costs a few hundred megabytes; one merged
// range spanning the whole grid costs more memory than any machine has.
//
// So every part the reader would parse is read here first, routed the way
// the reader routes it, and what becomes objects is counted against what the
// parser would accept anyway. Two more structures the reader expands, data
// validations and column definitions, are not read at all (`IGNORED_NODES`).
//
// This counts, it does not parse. Wherever the count could come out lower
// than what the reader builds, it takes the more expensive reading: a count
// that is too high refuses a file the parser would have refused, or one no
// spreadsheet program writes.

/** the ceilings, all together across the workbook */
export interface ContentLimits {
  /** worksheet parts the reader would parse */
  readonly maxSheets: number
  /** row elements */
  readonly maxRows: number
  /** cell elements, plus every cell a merged range or a defined name expands to */
  readonly maxCells: number
  /** merged ranges: the reader checks each one against every one before it */
  readonly maxMerges: number
  /** worksheet elements that are neither a row nor a cell: a value per cell, and the sheet's own furniture */
  readonly maxSheetElements: number
  /** entries in the shared string table */
  readonly maxSharedStrings: number
  /** elements of the shared string table other than its entries */
  readonly maxSharedElements: number
  /** elements of every other part the reader parses: styles, the workbook, drawings, comments */
  readonly maxOtherElements: number
}

/**
 * The worksheet elements the reader is told to skip: each is expanded cell
 * by cell from a range (a data validation over `A1:XFD1048576` is seventeen
 * billion entries, a column definition up to `max="2000000000"` two billion
 * objects), and no importer reads either.
 */
export const IGNORED_NODES = ['dataValidations', 'cols'] as const

type Route = 'sheet' | 'shared' | 'workbook' | 'other'

/**
 * Which parser the reader hands a part to, by its name, in the reader's own
 * order; `null` for a part it keeps as bytes or never reads. The patterns are
 * the reader's, unanchored as they are there.
 */
export const routeOf = (entryName: string): Route | null => {
  const name = entryName.startsWith('/') ? entryName.slice(1) : entryName
  switch (name) {
    case '_rels/.rels':
    case 'xl/_rels/workbook.xml.rels':
    case 'xl/styles.xml':
    case 'docProps/app.xml':
    case 'docProps/core.xml':
      return 'other'
    case 'xl/workbook.xml':
      return 'workbook'
    case 'xl/sharedStrings.xml':
      return 'shared'
  }
  if (/xl\/worksheets\/sheet(\d+)[.]xml/.test(name)) return 'sheet'
  if (/xl\/worksheets\/_rels\/sheet(\d+)[.]xml.rels/.test(name)) return 'other'
  // a theme is kept as its text, and media as bytes: neither becomes objects
  if (/xl\/theme\/([a-zA-Z0-9]+)[.]xml/.test(name)) return null
  if (/xl\/media\/([a-zA-Z0-9]+[.][a-zA-Z0-9]{3,4})$/.test(name)) return null
  if (/xl\/drawings\/([a-zA-Z0-9]+)[.]xml/.test(name)) return 'other'
  if (/xl\/(comments\d+)[.]xml/.test(name)) return 'other'
  if (/xl\/tables\/(table\d+)[.]xml/.test(name)) return 'other'
  if (/xl\/drawings\/_rels\/([a-zA-Z0-9]+)[.]xml[.]rels/.test(name)) return 'other'
  if (/xl\/drawings\/(vmlDrawing\d+)[.]vml/.test(name)) return 'other'
  return null
}

const LT = 0x3c
const GT = 0x3e
const SLASH = 0x2f

/** the bytes that end an element name */
const endsName = (byte: number) =>
  byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === SLASH || byte === GT

/**
 * Every start tag in a part: its name and where it begins. Closing tags,
 * declarations, comments and processing instructions are not elements; the
 * `<` of anything inside a comment or a CDATA section is counted as one,
 * which only ever makes the count higher.
 */
const eachTag = (xml: Buffer, visit: (name: string, at: number) => void): number => {
  let total = 0
  let at = xml.indexOf(LT)
  while (at !== -1) {
    const next = xml[at + 1]
    if (next !== undefined && next !== SLASH && next !== 0x3f && next !== 0x21) {
      let end = at + 1
      while (end < xml.length && !endsName(xml[end]!) && xml[end] !== LT) end += 1
      total += 1
      visit(xml.toString('latin1', at + 1, end), at)
    }
    at = xml.indexOf(LT, at + 1)
  }
  return total
}

/** where the start tag at `from` closes; a `>` inside a quoted value does not close it */
const tagEnd = (xml: Buffer, from: number): number => {
  let quote = 0
  for (let at = from; at < xml.length; at += 1) {
    const byte = xml[at]!
    if (quote !== 0) {
      if (byte === quote) quote = 0
    } else if (byte === 0x22 || byte === 0x27) quote = byte
    else if (byte === GT) return at
  }
  return -1
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** the text a parser hands over for an attribute value or a text node */
const decoded = (text: string) =>
  text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (whole, entity: string) => {
    if (!entity.startsWith('#')) return ENTITIES[entity] ?? whole
    const code =
      entity[1] === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })

/** every value of one attribute in a start tag, decoded; a repeated attribute is read every time */
const attributeValues = (tag: string, attribute: string): string[] => {
  const values: string[] = []
  for (const match of tag.matchAll(/[\s]([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (match[1] === attribute) values.push(decoded(match[2] ?? match[3] ?? ''))
  }
  return values
}

/** the reader's reading of a cell address: letters before digits are the column, digits the row */
const addressOf = (value: string) => {
  let hasColumn = false
  let hasRow = false
  let column = 0
  let row = 0
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at)
    if (!hasRow && code >= 65 && code <= 90) {
      hasColumn = true
      column = column * 26 + code - 64
    } else if (code >= 48 && code <= 57) {
      hasRow = true
      row = row * 10 + code - 48
    } else if (hasRow && hasColumn && code !== 36) {
      break
    }
  }
  // the reader throws on a column past XFD, and a range that throws expands to nothing
  if (hasColumn && column > 16384) return null
  return { column: hasColumn ? column : Number.NaN, row: hasRow ? row : Number.NaN }
}

/**
 * How many cells the reader creates for one range, read the way it reads a
 * range: an optional sheet name, then `tl:br` or a single address. Where it
 * would default a missing edge to 1 this does too, so a range of whole rows
 * counts a column of them.
 */
export const cellsIn = (reference: string): number => {
  const groups = /(?:(?:(?:'((?:[^']|'')*)')|([^'^ !]*))!)?(.*)/.exec(reference)
  const target = groups?.[3] ?? ''
  const parts = target.split(':')
  let top: number
  let left: number
  let bottom: number
  let right: number
  if (parts.length > 1) {
    const first = addressOf(parts[0]!)
    const second = addressOf(parts[1]!)
    if (first === null || second === null) return 0
    top = Math.min(first.row, second.row)
    left = Math.min(first.column, second.column)
    bottom = Math.max(first.row, second.row)
    right = Math.max(first.column, second.column)
  } else {
    if (target.startsWith('#')) return 0
    const only = addressOf(target)
    if (only === null) return 0
    top = bottom = only.row
    left = right = only.column
  }
  const rows = (bottom || 1) - (top || 1) + 1
  const columns = (right || 1) - (left || 1) + 1
  return Math.max(0, rows) * Math.max(0, columns)
}

/** the names the reader keeps out of its table of defined names and never expands */
const PRINT_NAMES = new Set(['_xlnm.Print_Area', '_xlnm.Print_Titles'])

/** the text of every defined name in the workbook part, as the reader would join it */
const definedNameTexts = (xml: Buffer, at: number, end: number): string | null => {
  const tag = xml.toString('utf8', at, end + 1)
  if (attributeValues(tag, 'name').some((name) => PRINT_NAMES.has(name))) return null
  // self-closing: no text
  if (xml[end - 1] === SLASH) return ''
  const close = xml.indexOf('</definedName', end + 1)
  if (close === -1) throw new ArchiveRefused('malformed')
  const inner = xml.toString('utf8', end + 1, close)
  // comments, CDATA and instructions are not text to the reader; a nested
  // tag is dropped and the text on both sides of it kept, which reads at
  // least as much as the reader does
  const text = inner
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<[^>]*>/g, '')
  return decoded(text)
}

/** the cells a defined name expands to, every comma-separated piece and the whole, added up */
const definedNameCells = (text: string) =>
  cellsIn(text) +
  text.split(',').reduce((sum, piece) => sum + (piece === '' ? 0 : cellsIn(piece)), 0)

/**
 * A running count over the parts of one archive, refusing the moment any of
 * it passes its ceiling.
 */
export const contentTally = (limits: ContentLimits) => {
  let sheets = 0
  let rows = 0
  let cells = 0
  let merges = 0
  let sheetElements = 0
  let sharedStrings = 0
  let sharedElements = 0
  let otherElements = 0

  const over = (count: number, ceiling: number, reason: 'too-large' | 'too-many-rows') => {
    if (count > ceiling) throw new ArchiveRefused(reason)
  }

  const sheet = (xml: Buffer) => {
    sheets += 1
    if (sheets > limits.maxSheets) throw new ArchiveRefused('too-many-sheets')
    let rowTags = 0
    let cellTags = 0
    const total = eachTag(xml, (name, at) => {
      if (name === 'row') rowTags += 1
      else if (name === 'c') cellTags += 1
      else if (name === 'mergeCell') {
        merges += 1
        over(merges, limits.maxMerges, 'too-large')
        const end = tagEnd(xml, at)
        if (end === -1) throw new ArchiveRefused('malformed')
        for (const ref of attributeValues(xml.toString('utf8', at, end + 1), 'ref')) {
          cells += cellsIn(ref)
        }
        over(cells, limits.maxCells, 'too-large')
      }
    })
    rows += rowTags
    cells += cellTags
    sheetElements += total - rowTags - cellTags
    over(rows, limits.maxRows, 'too-many-rows')
    over(cells, limits.maxCells, 'too-large')
    over(merges, limits.maxMerges, 'too-large')
    over(sheetElements, limits.maxSheetElements, 'too-large')
  }

  return {
    /** one part, by the name the reader will see and the bytes it will parse */
    add(entryName: string, xml: Buffer): void {
      const route = routeOf(entryName)
      if (route === null) return
      if (route === 'sheet') {
        sheet(xml)
        return
      }
      if (route === 'shared') {
        let entries = 0
        const total = eachTag(xml, (name) => {
          if (name === 'si') entries += 1
        })
        sharedStrings += entries
        sharedElements += total - entries
        over(sharedStrings, limits.maxSharedStrings, 'too-large')
        over(sharedElements, limits.maxSharedElements, 'too-large')
        return
      }
      otherElements += eachTag(xml, (name, at) => {
        if (route !== 'workbook' || name !== 'definedName') return
        const end = tagEnd(xml, at)
        if (end === -1) throw new ArchiveRefused('malformed')
        const text = definedNameTexts(xml, at, end)
        if (text !== null) cells += definedNameCells(text)
      })
      over(cells, limits.maxCells, 'too-large')
      over(otherElements, limits.maxOtherElements, 'too-large')
    },
  }
}
