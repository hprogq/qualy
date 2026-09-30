import { Schema } from 'effect'
import { AuditAction } from '@qualy/audit-contract/action'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

// The settings domain's audit actions. Details name which locales moved,
// never the words: what changed is the event's business, what it changed
// to is the row's.

export const TermOverrideUpdated = AuditAction.define({
  code: 'settings.term.update',
  target: 'settings.term',
  version: 1,
  name: text(m.audit_termUpdate),
  details: Schema.Struct({
    locales: Schema.Array(Schema.Literals(['zh-CN', 'en-US'])),
  }),
})

export const settingsActions = [TermOverrideUpdated] as const
