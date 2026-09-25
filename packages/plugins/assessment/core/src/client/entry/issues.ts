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
  'out-of-range': m.entryIssueOutOfRange,
  'out-of-material-range': m.entryIssueOutOfRange,
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

/** the sentence for one field's problem, completing the field's name */
export const issueSentence = (reason: string): MessageDescriptor =>
  ISSUE_SENTENCES[reason] ?? m.entryIssueOther

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
