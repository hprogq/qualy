import { defineErrorTranslations, type ErrorsByCode } from '@qualy/i18n-contract'
import type * as settingsErrors from '../server/errors.ts'
import type { Message } from '@qualy/i18n-contract'
import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

export const errorMessages = defineErrorTranslations<ErrorsByCode<typeof settingsErrors>>()({
  SETTING_NOT_FOUND: m.error_notFound,
  SETTING_VERSION_CONFLICT: m.error_versionConflict,
  SETTING_VALUE_INVALID: m.error_valueInvalid,
}).registry

// the messages the server names over the wire, by the id it sends
export const wireMessages: Record<string, Message> = {
  'settings/audit/term-update': m.audit_termUpdate,
  'settings/nav-group/tenant': m.navGroup_tenant,
  'settings/navigation/terminology': m.navigation_terminology,
  'settings/permission-group/settings': m.permissionGroup_settings,
  'settings/permission/terminology-manage': m.permission_terminologyManage,
}
