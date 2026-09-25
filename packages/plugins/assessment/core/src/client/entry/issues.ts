import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentMessages as m } from '../i18n.ts'

// What is wrong with one field of a filing, as the server names it.
//
// The filing dialog lists these beside the fields; a press made where no
// form is open (handing on a kept claim, a one-press declaration) says them
// in its toast instead, so both read the same words.

/** the payload refusals the driver can raise, as sentences about one field */
const ISSUE_SENTENCES: Record<string, MessageDescriptor> = {
  required: m.entryIssueRequired,
  // a value past the field's own bounds; a date field bound to the round's
  // window reports its window with the same code (see issueSentence)
  'out-of-range': m.entryIssueOutOfRange,
  // a date the scoring rule reads, outside the round's material window
  'out-of-material-range': m.entryIssueOutOfMaterialRange,
  'too-short': m.entryIssueTooShort,
  'pattern-mismatch': m.entryIssuePatternMismatch,
  'not-a-date': m.entryIssueNotADate,
  'not-an-integer': m.entryIssueNotAnInteger,
  'not-a-decimal': m.entryIssueNotADecimal,
  'too-precise': m.entryIssueTooPrecise,
  'not-a-choice': m.entryIssueNotAChoice,
  'not-text': m.entryIssueNotText,
  'not-a-boolean': m.entryIssueNotABoolean,
  'too-long': m.entryIssueTooLong,
  'too-many': m.entryIssueTooMany,
  'too-many-attachments': m.entryIssueTooMany,
  'not-attachments': m.entryIssueFileMissing,
  'attachment-too-large': m.entryIssueFileTooLarge,
  'attachment-type': m.entryIssueFileType,
  'attachment-not-found': m.entryIssueFileMissing,
  'attachment-retired': m.entryIssueFileMissing,
  'attachment-not-yours': m.entryIssueFileNotYours,
  'attachment-cross-entry': m.entryIssueFileElsewhere,
  'duplicate-attachment': m.entryIssueFileElsewhere,
}

/**
 * The sentence for one field's problem, completing the field's name.
 *
 * The evidence driver reports a date outside the round's material window as
 * `out-of-range`, the same code a date past the field's own earliest or
 * latest raises: the driver folds the window and the field's bounds into one
 * range, the narrower of each. So which news it is depends on where the date
 * fell. A date inside the window broke the field's own bounds; one outside
 * it is outside the round's material period, whatever else it broke. Where
 * the date is not known, a field the window binds and that sets no bounds of
 * its own can only have been refused by the window; one that also sets its
 * own bounds is said in the field's words, which are true either way.
 */
export const issueSentence = (
  reason: string,
  field?: {
    readonly type?: string
    readonly inMaterialRange?: boolean
    readonly min?: unknown
    readonly max?: unknown
  },
  seen?: {
    /** the value the refused save carried for this field */
    readonly value?: unknown
    /** the round's material window: start inclusive, end exclusive */
    readonly materialRange?: { readonly start: string; readonly end: string }
  },
): MessageDescriptor => {
  if (reason !== 'out-of-range' || field?.type !== 'date' || field.inMaterialRange !== true) {
    return ISSUE_SENTENCES[reason] ?? m.entryIssueOther
  }
  const value = seen?.value
  const window = seen?.materialRange
  if (typeof value === 'string' && window !== undefined) {
    const inside = value >= window.start && value < window.end
    return inside ? m.entryIssueOutOfRange : m.entryIssueOutOfMaterialRange
  }
  const ownBounds = field.min !== undefined || field.max !== undefined
  return ownBounds ? m.entryIssueOutOfRange : m.entryIssueOutOfMaterialRange
}

/** the fields a save was refused over, or null when the failure is not that */
export const payloadIssuesOf = (
  error: unknown,
): readonly { field: string; reason: string }[] | null => {
  const raised = error as { _tag?: string; issues?: unknown }
  if (raised?._tag !== 'ASSESSMENT_ENTRY_PAYLOAD_INVALID' || !Array.isArray(raised.issues)) {
    return null
  }
  const issues = raised.issues as readonly { field: string; reason: string }[]
  return issues.length === 0 ? null : issues
}
