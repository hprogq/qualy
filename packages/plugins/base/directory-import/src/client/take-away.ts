/**
 * Rows as csv text, safe to open in a spreadsheet.
 *
 * Every cell is quoted, and one that opens with a character a spreadsheet
 * reads as the start of a formula gets a leading apostrophe. Quoting alone
 * does not stop Excel or WPS from evaluating `=HYPERLINK(...)` or a DDE
 * payload, and what goes into this file is partly what an imported workbook
 * held: unit names, paths, identifiers.
 */
export const csvOf = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => row.map(csvCell).join(',')).join('\r\n')

const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r', '\n'])

const csvCell = (cell: string): string => {
  const inert = FORMULA_START.has(cell.charAt(0)) ? `'${cell}` : cell
  return `"${inert.replaceAll('"', '""')}"`
}
