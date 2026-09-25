import type { AtomicSchema } from '@qualy/value-schema'
import { kindOf } from '@qualy/value-schema'
import { hashCanonicalJson } from '@qualy/value-schema/hash'
import type { ParsedWorkbook, RawRow, TemplateColumn } from './workbook.ts'
import { entryLimitOf } from '../entry/limit.ts'

// What a workbook would do, worked out without writing anything.
//
// Everything here is a judgment about VALUES: whether a cell can be read as
// the type its column declares, whether the row names somebody, whether the
// determination is complete, whether the basis is there. Who may do it, and
// whether the round is open, are settled before this runs - by the caller,
// once, rather than per row.
//
// The shape is deliberately "collect, do not throw": a person who filled in
// a hundred and twenty rows is owed every mistake at once. Only the FILE
// being unreadable stops the walk, because then there are no rows to judge.

export interface PreviewIssue {
  readonly severity: 'error' | 'warning'
  readonly field: string | null
  readonly reason: string
}

export interface PreviewRow {
  readonly rowNo: number
  readonly businessNo: string
  readonly displayNameFromFile: string
  readonly matchedParticipant: {
    readonly id: string
    readonly displayName: string
    readonly businessNo: string | null
  } | null
  readonly payload: Record<string, unknown>
  readonly recognition: Record<string, unknown>
  readonly basis: string
  readonly issues: readonly PreviewIssue[]
  /** what the determination says, as the proof cache keys it */
  readonly recognitionHash: string
}

const issue = (
  severity: 'error' | 'warning',
  field: string | null,
  reason: string,
): PreviewIssue => ({ severity, field, reason })

/**
 * How wide the columns are that a row's own text is written into.
 *
 * The question's fields are held to their schema by the payload decoder, but
 * the name as the file spells it and the basis go straight into columns of
 * their own. Past these widths a row passed every judgment here and was
 * refused only by the database, inside the commit's transaction - which the
 * reader saw as the service failing rather than as a row to shorten. The
 * entity declarations are the source of both numbers; a test keeps these
 * equal to them.
 */
export const WRITTEN_TEXT_WIDTHS = {
  /** administrative_entry_import_rows.display_name_snapshot */
  displayName: 255,
  /** entry_revisions.note, where the basis of the fact is kept */
  basis: 500,
} as const

/**
 * A text's width the way a varchar column counts it: in characters, not in
 * the UTF-16 units `length` counts, or a name with an emoji in it would be
 * refused for a width it does not take.
 */
const widthOf = (text: string) => {
  let width = 0
  for (const _ of text) width += 1
  return width
}

/**
 * A cell's text as the value its column declares.
 *
 * Text arrives as text; everything else is a narrow, explicit reading. A
 * decimal stays a string all the way to the canonicaliser, because a
 * calculator that was handed an IEEE double has already lost the question.
 */
export const readCell = (
  column: TemplateColumn,
  schema: AtomicSchema | undefined,
  text: string,
): { value: unknown } | { reason: string } => {
  if (text === '') return { value: undefined }
  switch (column.type) {
    case 'text':
      return { value: text }
    case 'date': {
      // the template asks for YYYY-MM-DD and a date cell was already
      // normalised to the calendar day by the parser; anything else is the
      // person's own typing and is held to the same shape
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { reason: 'date-syntax' }
      return { value: text }
    }
    case 'integer': {
      if (!/^-?\d+$/.test(text)) return { reason: 'integer-syntax' }
      const n = Number(text)
      if (!Number.isSafeInteger(n)) return { reason: 'integer-range' }
      return { value: n }
    }
    case 'decimal': {
      // a string, deliberately: the canonicaliser downstream is the one
      // thing allowed to decide what 0.10 and 0.1 have in common
      if (!/^-?\d+(\.\d+)?$/.test(text)) return { reason: 'decimal-syntax' }
      return { value: text }
    }
    case 'boolean': {
      if (text === '是' || text === 'true' || text === 'TRUE') return { value: true }
      if (text === '否' || text === 'false' || text === 'FALSE') return { value: false }
      return { reason: 'boolean-syntax' }
    }
    case 'choice': {
      const offered = column.choices ?? []
      const byLabel = offered.find((one) => one.label === text)
      if (byLabel !== undefined) return { value: byLabel.value }
      // the stable value itself is accepted too: somebody who pasted a
      // column out of another system has not made a mistake
      const byValue = offered.find((one) => one.value === text)
      if (byValue !== undefined) return { value: byValue.value }
      // a schema with no labels in the template still has its own values
      if (offered.length === 0 && schema !== undefined && kindOf(schema) === 'choice') {
        const values = (schema as { enum: readonly string[] }).enum
        if (values.includes(text)) return { value: text }
      }
      return { reason: 'choice-unknown' }
    }
    default:
      return { reason: 'unreadable' }
  }
}

export interface PreviewInput {
  readonly parsed: ParsedWorkbook
  readonly defaultBasis: string
  /** the business numbers this caller may actually record on */
  readonly reachable: ReadonlyMap<
    string,
    { readonly id: string; readonly displayName: string; readonly businessNo: string | null }
  >
  /**
   * The columns to judge by: the question's own, placed where the file put
   * them, proven by `provenColumns`. Deliberately not read off
   * `parsed.metadata` - that is the file's word, and what a column means is
   * not the file's to say.
   */
  readonly columns: readonly TemplateColumn[]
  /** the question's own fields and the determination's, from the frozen revision */
  readonly evidenceSchemas: ReadonlyMap<string, AtomicSchema>
  readonly recognitionSchemas: ReadonlyMap<string, AtomicSchema>
  /** which recognition ids the question requires a value for */
  readonly requiredRecognitionIds: readonly string[]
  /** how many effective claims each participant already holds on this question */
  readonly held: ReadonlyMap<string, number>
  readonly maxEntries: number | null
  /** the caller's own user id, so a row about themselves is refused */
  readonly actorUserId: string
  readonly participantUserIds: ReadonlyMap<string, string>
}

/**
 * Every row judged, with the same answer the writer would reach.
 *
 * Quota is counted across the file as well as against the database: two
 * rows for one person on a question that admits one are two rows that
 * cannot both be written, and saying so only at commit would be telling
 * somebody after they pressed the button.
 */
export const judgeRows = (input: PreviewInput): readonly PreviewRow[] => {
  const out: PreviewRow[] = []
  const takenInFile = new Map<string, number>()

  for (const row of input.parsed.rows) {
    const issues: PreviewIssue[] = []
    const payload: Record<string, unknown> = Object.create(null)
    const recognition: Record<string, unknown> = Object.create(null)

    const matched = row.businessNo === '' ? undefined : input.reachable.get(row.businessNo)
    if (row.businessNo === '') {
      issues.push(issue('error', 'businessNo', 'business-no-required'))
    } else if (matched === undefined) {
      // unknown, excluded, or outside this caller's reach - all one answer,
      // because telling them apart turns the import door into a directory
      issues.push(issue('error', 'businessNo', 'participant-not-found'))
    } else if (input.participantUserIds.get(matched.id) === input.actorUserId) {
      issues.push(issue('error', 'businessNo', 'self-record-refused'))
    } else if (widthOf(row.displayName) > WRITTEN_TEXT_WIDTHS.displayName) {
      // kept as the file spelled it, so it has to fit where it is kept; a
      // warning here would be a promise the commit cannot keep
      issues.push(issue('error', 'displayName', 'too-long'))
    } else if (row.displayName !== '' && row.displayName !== matched.displayName) {
      // not a blocker: a nickname in the file is a person being careless,
      // not a person being wrong about who they meant
      issues.push(issue('warning', 'displayName', 'name-mismatch'))
    }

    for (const column of input.columns) {
      const text = Object.hasOwn(row.cells, column.column) ? row.cells[column.column]! : ''
      const schema =
        column.kind === 'evidence'
          ? input.evidenceSchemas.get(column.key)
          : input.recognitionSchemas.get(column.key)
      const read = readCell(column, schema, text)
      if ('reason' in read) {
        issues.push(issue('error', `${column.kind}.${column.key}`, read.reason))
        continue
      }
      if (read.value === undefined) continue
      if (column.kind === 'evidence') payload[column.key] = read.value
      else recognition[column.key] = read.value
    }

    // what the office determines, where the file left it to the defaults
    for (const id of input.requiredRecognitionIds) {
      if (!Object.hasOwn(recognition, id)) {
        issues.push(issue('error', `recognition.${id}`, 'recognition-required'))
      }
    }

    const basis = row.basis.trim() !== '' ? row.basis.trim() : input.defaultBasis.trim()
    if (basis === '') issues.push(issue('error', 'basis', 'basis-required'))
    else if (widthOf(basis) > WRITTEN_TEXT_WIDTHS.basis) {
      issues.push(issue('error', 'basis', 'too-long'))
    }

    if (matched !== undefined) {
      const already = input.held.get(matched.id) ?? 0
      const takenHere = takenInFile.get(matched.id) ?? 0
      const ceiling = entryLimitOf(input.maxEntries)
      if (already + takenHere >= ceiling.limit) {
        issues.push(issue('error', null, ceiling.reason))
      }
      takenInFile.set(matched.id, takenHere + 1)
    }

    out.push({
      rowNo: row.rowNo,
      businessNo: row.businessNo,
      displayNameFromFile: row.displayName,
      matchedParticipant: matched ?? null,
      payload,
      recognition,
      basis,
      issues,
      recognitionHash: hashCanonicalJson(recognition),
    })
  }
  return out
}

/**
 * The same fact twice, said out loud and never refused: some questions are
 * won more than once, and the basis is deliberately not part of what makes
 * two facts the same.
 *
 * Its own pass because the values only become comparable after the question's
 * own decoder and the determination's canonicaliser have run. The reader
 * keeps a decimal as the text somebody typed, on purpose - the canonicaliser
 * is the one thing allowed to decide what 3.0 and 3.00 have in common - so
 * fingerprinting the readings missed every duplicate that was merely spelt
 * differently, and both rows committed without anybody being asked.
 *
 * A row that will not be written cannot duplicate anything, so a row already
 * carrying an error is passed over: what is wrong with it is the error.
 */
export const markDuplicateFacts = (rows: readonly PreviewRow[]): readonly PreviewRow[] => {
  const seen = new Set<string>()
  return rows.map((row) => {
    if (row.matchedParticipant === null) return row
    if (row.issues.some((one) => one.severity === 'error')) return row
    const fingerprint = hashCanonicalJson({
      participantId: row.matchedParticipant.id,
      payload: row.payload,
      recognition: row.recognition,
    })
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint)
      return row
    }
    return { ...row, issues: [...row.issues, issue('warning', null, 'duplicate-in-file')] }
  })
}

/** the tally a preview reports, counted from the rows themselves */
export const summarise = (rows: readonly PreviewRow[]) => {
  let errors = 0
  let warnings = 0
  let valid = 0
  for (const row of rows) {
    const bad = row.issues.some((one) => one.severity === 'error')
    const warned = row.issues.some((one) => one.severity === 'warning')
    if (bad) errors += 1
    else valid += 1
    if (warned) warnings += 1
  }
  return { rows: rows.length, valid, warnings, errors }
}

/** the one thing worth asserting about the shape of a blank workbook */
export const noRows = (parsed: ParsedWorkbook): boolean => parsed.rows.length === 0

export type { RawRow }
