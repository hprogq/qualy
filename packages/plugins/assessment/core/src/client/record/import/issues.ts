import * as m from '#messages'

// What an import problem says, in the reader's words.
//
// The server names a problem with a stable code and the field it is about;
// this is the one place those become sentences. A code this build has no
// words for still says something - its own name - because a row that turns
// red without a reason is the failure this list exists to prevent.

/** the reasons whose sentence names the tenant's word for a person's identifier */
const WORDED = {
  'business-no-required': m.record_import_reason_businessNoRequired,
  'participant-not-found': m.record_import_reason_participantNotFound,
} as const

const WORDS = {
  'self-record-refused': m.record_import_reason_selfRecordRefused,
  'name-mismatch': m.record_import_reason_nameMismatch,
  'basis-required': m.record_import_reason_basisRequired,
  'recognition-required': m.record_import_reason_recognitionRequired,
  missing: m.record_import_reason_recognitionRequired,
  'max-entries-reached': m.record_import_reason_maxEntriesReached,
  'entry-ceiling-reached': m.record_import_reason_maxEntriesReached,
  'account-ceiling-reached': m.record_import_reason_accountCeilingReached,
  'duplicate-in-file': m.record_import_reason_duplicateInFile,
  'decimal-syntax': m.record_import_reason_decimalSyntax,
  'integer-syntax': m.record_import_reason_integerSyntax,
  'integer-range': m.record_import_reason_integerRange,
  'date-syntax': m.record_import_reason_dateSyntax,
  'not-a-date': m.record_import_reason_dateSyntax,
  'choice-unknown': m.record_import_reason_choiceUnknown,
  'boolean-syntax': m.record_import_reason_booleanSyntax,
  required: m.record_import_reason_required,
  // past a field's own bounds, a number or a date alike
  'out-of-range': m.record_import_reason_outOfRange,
  // the round's material window, reached through what the office determined
  'out-of-material-range': m.record_import_reason_outOfMaterialRange,
  'too-long': m.record_import_reason_tooLong,
  // a text field's own minimum length and pattern, as the driver checks them
  'too-short': m.record_import_reason_tooShort,
  'pattern-mismatch': m.record_import_reason_patternMismatch,
  'participant-out-of-scope': m.record_import_reason_participantOutOfScope,
  'phase-closed': m.record_import_reason_phaseClosed,
  'no-active-phase': m.record_import_reason_noActivePhase,
  'item-out-of-scope': m.record_import_reason_itemOutOfScope,
  'permission-not-held': m.record_import_reason_permissionNotHeld,
  'entry-not-abandonable': m.record_import_reason_entryNotAbandonable,
  'not-xlsx': m.record_import_reason_notXlsx,
  'file-too-large': m.record_import_reason_fileTooLarge,
  'source-too-large': m.record_import_reason_fileTooLarge,
  'too-many-rows': m.record_import_reason_tooManyRows,
  'too-many-columns': m.record_import_reason_tooManyColumns,
  'too-many-sheets': m.record_import_reason_tooManySheets,
  'too-many-cells': m.record_import_reason_tooManyCells,
  'data-sheet-missing': m.record_import_reason_dataSheetMissing,
  'extra-sheet': m.record_import_reason_extraSheet,
  'extra-column': m.record_import_reason_extraColumn,
  'column-missing': m.record_import_reason_columnMissing,
  'column-unknown': m.record_import_reason_columnUnknown,
  'column-header-mismatch': m.record_import_reason_columnHeaderMismatch,
  'metadata-missing': m.record_import_reason_metadataMissing,
  'metadata-corrupt': m.record_import_reason_metadataCorrupt,
  'unsupported-template-version': m.record_import_reason_unsupportedTemplateVersion,
  'template-for-another-item': m.record_import_reason_templateForAnotherItem,
  'formula-not-allowed': m.record_import_reason_formulaNotAllowed,
  'percent-not-allowed': m.record_import_reason_percentNotAllowed,
  'cell-too-long': m.record_import_reason_cellTooLong,
  'cell-error': m.record_import_reason_cellError,
  'source-unavailable': m.record_import_reason_sourceUnavailable,
  'no-rows': m.record_import_reason_noRows,
  unreadable: m.record_import_reason_unreadable,
} as const

export interface ImportIssue {
  readonly severity: 'error' | 'warning'
  readonly field: string | null
  readonly reason: string
  readonly detail?: string | undefined
}

/** the sentence for one problem; `businessNo` is the tenant's word for a person's identifier */
export const reasonText = (issue: Pick<ImportIssue, 'reason' | 'detail'>, businessNo: string) => {
  if (issue.reason === 'determination-refused') {
    return m.record_import_reason_determinationRefused({ detail: issue.detail ?? '' })
  }
  if (Object.hasOwn(WORDED, issue.reason)) {
    return WORDED[issue.reason as keyof typeof WORDED]({ businessNo })
  }
  const word = Object.hasOwn(WORDS, issue.reason)
    ? WORDS[issue.reason as keyof typeof WORDS]
    : undefined
  return word === undefined ? m.record_import_reason_other({ reason: issue.reason }) : word()
}

/** the names a question gives its own columns, for saying which cell is wrong */
export interface ColumnNames {
  readonly evidence: ReadonlyMap<string, string>
  readonly recognition: ReadonlyMap<string, string>
}

/** which column a problem is about, as the header the reader filled in */
export const fieldText = (field: string | null, names: ColumnNames, businessNo: string) => {
  if (field === null) return null
  if (field === 'businessNo') return businessNo
  if (field === 'displayName') return m.record_import_columnName()
  if (field === 'basis') return m.record_basis()
  if (field === 'recognition') return m.record_recognition()
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
