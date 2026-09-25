import type { useI18n } from '@qualy/web-i18n'
import { assessmentMessages as m } from '../../i18n.ts'

// What an import problem says, in the reader's words.
//
// The server names a problem with a stable code and the field it is about;
// this is the one place those become sentences. A code this build has no
// words for still says something - its own name - because a row that turns
// red without a reason is the failure this list exists to prevent.

type Format = ReturnType<typeof useI18n>['format']

/** the reasons whose sentence names the tenant's word for a person's identifier */
const WORDED = {
  'business-no-required': m.importReasonBusinessNoRequired,
  'participant-not-found': m.importReasonParticipantNotFound,
} as const

const WORDS = {
  'self-record-refused': m.importReasonSelfRecord,
  'name-mismatch': m.importReasonNameMismatch,
  'basis-required': m.importReasonBasisRequired,
  'recognition-required': m.importReasonRecognitionRequired,
  missing: m.importReasonRecognitionRequired,
  'max-entries-reached': m.importReasonMaxEntries,
  'duplicate-in-file': m.importReasonDuplicate,
  'decimal-syntax': m.importReasonDecimal,
  'integer-syntax': m.importReasonInteger,
  'integer-range': m.importReasonIntegerRange,
  'date-syntax': m.importReasonDate,
  'not-a-date': m.importReasonDate,
  'choice-unknown': m.importReasonChoice,
  'boolean-syntax': m.importReasonBoolean,
  required: m.importReasonRequired,
  'out-of-range': m.importReasonOutOfRange,
  // the same window, reached through what the office determined
  'out-of-material-range': m.importReasonOutOfRange,
  'too-long': m.importReasonTooLong,
  'participant-out-of-scope': m.importReasonOutOfScope,
  'phase-closed': m.importReasonPhaseClosed,
  'no-active-phase': m.importReasonNoPhase,
  'item-out-of-scope': m.importReasonItemOutOfScope,
  'permission-not-held': m.importReasonNotHeld,
  'entry-not-abandonable': m.importReasonNotAbandonable,
  'not-xlsx': m.importReasonNotXlsx,
  'file-too-large': m.importReasonTooLarge,
  'source-too-large': m.importReasonTooLarge,
  'too-many-rows': m.importReasonTooManyRows,
  'too-many-columns': m.importReasonTooManyColumns,
  'too-many-sheets': m.importReasonTooManySheets,
  'too-many-cells': m.importReasonTooManyCells,
  'data-sheet-missing': m.importReasonSheetMissing,
  'extra-sheet': m.importReasonExtraSheet,
  'extra-column': m.importReasonExtraColumn,
  'column-missing': m.importReasonColumnMissing,
  'column-unknown': m.importReasonColumnUnknown,
  'column-header-mismatch': m.importReasonColumnHeader,
  'metadata-missing': m.importReasonMetadataMissing,
  'metadata-corrupt': m.importReasonMetadataCorrupt,
  'unsupported-template-version': m.importReasonOldTemplate,
  'template-for-another-item': m.importReasonOtherItem,
  'formula-not-allowed': m.importReasonFormula,
  'percent-not-allowed': m.importReasonPercent,
  'cell-too-long': m.importReasonCellTooLong,
  'cell-error': m.importReasonCellError,
  'source-unavailable': m.importReasonUnavailable,
  'no-rows': m.importReasonNoRows,
  unreadable: m.importReasonUnreadable,
} as const

export interface ImportIssue {
  readonly severity: 'error' | 'warning'
  readonly field: string | null
  readonly reason: string
  readonly detail?: string | undefined
}

/** the sentence for one problem; `businessNo` is the tenant's word for a person's identifier */
export const reasonText = (
  format: Format,
  issue: Pick<ImportIssue, 'reason' | 'detail'>,
  businessNo: string,
) => {
  if (issue.reason === 'determination-refused') {
    return format(m.importReasonDetermination, { detail: issue.detail ?? '' })
  }
  if (Object.hasOwn(WORDED, issue.reason)) {
    return format(WORDED[issue.reason as keyof typeof WORDED], { businessNo })
  }
  const word = Object.hasOwn(WORDS, issue.reason)
    ? WORDS[issue.reason as keyof typeof WORDS]
    : undefined
  return word === undefined ? format(m.importReasonOther, { reason: issue.reason }) : format(word)
}

/** the names a question gives its own columns, for saying which cell is wrong */
export interface ColumnNames {
  readonly evidence: ReadonlyMap<string, string>
  readonly recognition: ReadonlyMap<string, string>
}

/** which column a problem is about, as the header the reader filled in */
export const fieldText = (
  format: Format,
  field: string | null,
  names: ColumnNames,
  businessNo: string,
) => {
  if (field === null) return null
  if (field === 'businessNo') return businessNo
  if (field === 'displayName') return format(m.importColumnName)
  if (field === 'basis') return format(m.recordBasis)
  if (field === 'recognition') return format(m.recordRecognition)
  if (field.startsWith('evidence.')) {
    const key = field.slice('evidence.'.length)
    return names.evidence.get(key) ?? key
  }
  if (field.startsWith('recognition.')) {
    const id = field.slice('recognition.'.length)
    return names.recognition.get(id) ?? id
  }
  return field
}
