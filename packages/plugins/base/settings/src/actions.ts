import { Schema } from 'effect'
import { message } from '@qualy/i18n-contract'
import { AuditAction } from '@qualy/audit-contract/action'

// The settings domain's audit actions. Details name which locales moved,
// never the words: what changed is the event's business, what it changed
// to is the row's.

export const TermOverrideUpdated = AuditAction.define({
  code: 'settings.term.update',
  target: 'settings.term',
  version: 1,
  name: message('settings/audit/term-update', 'Change terminology'),
  details: Schema.Struct({
    locales: Schema.Array(Schema.Literals(['zh-CN', 'en-US'])),
  }),
})

export const settingsActions = [TermOverrideUpdated] as const
