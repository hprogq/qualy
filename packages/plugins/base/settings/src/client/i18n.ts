import { defineErrorTranslations, type ErrorsByCode } from '@qualy/i18n-contract'
import type * as settingsErrors from '../server/errors.ts'
import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

export const errorMessages = defineErrorTranslations<ErrorsByCode<typeof settingsErrors>>()({
  SETTING_NOT_FOUND: m.error_notFound,
  SETTING_VERSION_CONFLICT: m.error_versionConflict,
  SETTING_VALUE_INVALID: m.error_valueInvalid,
}).registry
