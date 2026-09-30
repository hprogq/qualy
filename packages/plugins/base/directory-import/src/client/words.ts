import * as m from '#messages'

// What an import problem says, in the reader's words; and when something
// happened, in their calendar.

export interface IssueLike {
  readonly field: string | null
  readonly reason: string
  readonly detail?: string | undefined
  /** the row a cell-level refusal points at, when the engine says */
  readonly rowNo?: number | null | undefined
}

/** the cell a refusal points at, as a spreadsheet names it, or none */
const cellOf = (issue: IssueLike): string =>
  issue.field !== null && issue.rowNo !== null && issue.rowNo !== undefined
    ? `${issue.field}${String(issue.rowNo)}`
    : 'none'

const FIELD_WORDS = {
  displayName: m.field_displayName,
  userType: m.field_userType,
  organization: m.field_organization,
} as const

/** the sentence for one problem; `businessNo` is the tenant's word for a person's identifier */
export const issueText = (issue: IssueLike, businessNo: string): string => {
  switch (issue.reason) {
    case 'business-no-required':
      return m.issue_businessNoRequired({ businessNo })
    case 'business-no-too-long':
      return m.issue_businessNoTooLong({ businessNo })
    case 'duplicate-in-file':
      return m.issue_duplicateInFile({ businessNo, row: issue.detail ?? '' })
    case 'display-name-required':
      return m.issue_displayNameRequired()
    case 'display-name-too-long':
      return m.issue_displayNameTooLong()
    case 'org-level-required':
      return m.issue_orgLevelRequired()
    case 'org-name-too-long':
      return m.issue_orgNameTooLong()
    case 'control-character':
      return m.issue_controlCharacter()
    case 'too-many-cells':
      return m.issue_tooManyCells()
    case 'not-xlsx':
      return m.issue_notXlsx()
    case 'file-too-large':
    case 'source-too-large':
      return m.issue_fileTooLarge()
    case 'too-many-sheets':
      return m.issue_tooManySheets()
    case 'sheet-missing':
      return m.issue_sheetMissing()
    case 'too-many-rows':
      return m.issue_tooManyRows()
    case 'too-many-columns':
      return m.issue_tooManyColumns()
    case 'cell-too-long':
      return m.issue_cellTooLong({ cell: cellOf(issue) })
    case 'formula-not-allowed':
      return m.issue_formulaNotAllowed({ cell: cellOf(issue) })
    case 'cell-error':
      return m.issue_cellError({ cell: cellOf(issue) })
    case 'header-row-out-of-range':
      return m.issue_headerRowOutOfRange()
    case 'unreadable':
      return m.issue_unreadable()
    case 'user-conflict':
      return m.issue_userConflict({
        businessNo,
        fields: (issue.detail ?? '')
          .split(',')
          .filter((field) => field !== '')
          .map((field) =>
            Object.hasOwn(FIELD_WORDS, field)
              ? FIELD_WORDS[field as keyof typeof FIELD_WORDS]()
              : field,
          )
          .join('/'),
      })
    case 'business-no-taken':
      return m.issue_businessNoTaken({ businessNo })
    case 'node-type-conflict':
      return m.issue_nodeTypeConflict({ path: issue.detail ?? '' })
    case 'unit-out-of-reach':
      return m.issue_unitOutOfReach({ path: issue.detail ?? '' })
    case 'placement-out-of-reach':
      return m.issue_placementOutOfReach({ path: issue.detail ?? '' })
    default:
      return m.issue_other({ reason: issue.reason })
  }
}

/** a moment as the reader's calendar writes it: month, day, time */
export const whenText = (locale: string, iso: string): string =>
  new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
