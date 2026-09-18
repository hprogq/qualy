import {
  templateLayout,
  type ParsedWorkbook,
  type TemplateColumn,
  type TemplateSpec,
} from './workbook.ts'

// What each column of an uploaded workbook MEANS, decided here and nowhere
// else.
//
// The file is allowed to say where a field was put, because a person may
// reorder the columns they see. It is not allowed to say what a field is, or
// which stored value a word stands for: the hidden sheet that carries those
// claims is `veryHidden` rather than signed, and whoever fills a template in
// can edit it.
//
// The gap that closes is not about illegal values. Every check downstream -
// the payload decoder, the recognition judge - asks whether the RESULT is a
// legal value, and a remapped label produces a perfectly legal one. What none
// of them could ask is whether the result is the reading the person saw. A
// hidden sheet saying 国家级 -> provincial passed all of them while the
// workbook on screen said 国家级, and the round recorded the other thing.
//
// So the meaning comes from the question, and the placement is proven against
// the header the person read.

/** why a workbook's column mapping is not the question's */
export type ColumnRefusal =
  | { readonly reason: 'column-missing'; readonly field: string }
  | { readonly reason: 'column-unknown'; readonly field: string }
  | { readonly reason: 'column-header-mismatch'; readonly field: string; readonly column: string }

const fieldName = (column: { kind: string; key: string }) => `${column.kind}.${column.key}`

/**
 * The columns to judge a file by: the question's own, placed where the file
 * says they are, once that placement has been shown to be the one on screen.
 *
 * Refuses rather than reconciles. A file that is missing a field, carries one
 * the question does not have, or points a field at a column headed something
 * else is not a file to interpret generously - it is one to send back.
 */
export const provenColumns = (
  parsed: ParsedWorkbook,
  spec: Pick<TemplateSpec, 'locale' | 'evidence' | 'recognition'>,
):
  | { readonly columns: readonly TemplateColumn[] }
  | { readonly refusals: readonly ColumnRefusal[] } => {
  const canonical = templateLayout(spec).columns
  const placed = new Map(parsed.metadata.columns.map((one) => [fieldName(one), one]))
  const refusals: ColumnRefusal[] = []
  const columns: TemplateColumn[] = []

  for (const column of canonical) {
    const placement = placed.get(fieldName(column))
    if (placement === undefined) {
      refusals.push({ reason: 'column-missing', field: fieldName(column) })
      continue
    }
    placed.delete(fieldName(column))
    // the anchor: the words above the column the file points at have to be
    // the words this question writes for this field
    if ((parsed.headers[placement.column] ?? '') !== column.header) {
      refusals.push({
        reason: 'column-header-mismatch',
        field: fieldName(column),
        column: placement.column,
      })
      continue
    }
    // placement from the file, meaning from the question - never the other
    // way round, and never a merge of the two
    columns.push({ ...column, column: placement.column })
  }

  // a field the question does not have. Left in the file it would be read,
  // keyed and carried into a payload the decoder would then refuse with a
  // reason about the value; said here it is what it is
  for (const leftover of placed.values()) {
    refusals.push({ reason: 'column-unknown', field: fieldName(leftover) })
  }

  return refusals.length > 0 ? { refusals } : { columns }
}
