import { defineErrorTranslations, type ErrorsByCode } from '@qualy/i18n-contract'
import type * as directoryErrors from '../server/errors.ts'
import type { Message } from '@qualy/i18n-contract'
import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

export const errorMessages = defineErrorTranslations<ErrorsByCode<typeof directoryErrors>>()({
  USER_IMPORT_NOT_FOUND: m.error_notFound,
  USER_IMPORT_INVALID: m.error_invalid,
  USER_IMPORT_MAPPING_INVALID: m.error_mappingInvalid,
  USER_IMPORT_PLAN_CHANGED: m.error_planChanged,
  USER_IMPORT_SOURCE_UNAVAILABLE: m.error_sourceUnavailable,
  USER_IMPORT_BUSY: m.error_busy,
  USER_IMPORT_SOURCE_USED: m.error_sourceUsed,
}).registry

// the messages the server names over the wire, by the id it sends
export const wireMessages: Record<string, Message> = {
  'directory-import/audit/clean-nodes': m.audit_cleanNodes,
  'directory-import/audit/commit': m.audit_commit,
  'directory-import/audit/reverse': m.audit_reverse,
}
