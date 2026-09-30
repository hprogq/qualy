import { Schema } from 'effect'
import { AuditAction } from '@qualy/audit-contract/action'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

// The organization domain's audit actions: pure constants, like
// ./permissions. Details carry ids and field names, never the values - what
// changed is the event's business, what it changed TO is the row's.

const id = Schema.String

export const NodeCreated = AuditAction.define({
  code: 'org.node.create',
  target: 'org.node',
  version: 1,
  name: text(m.audit_nodeCreate),
  details: Schema.Struct({ parentId: id, orgTypeId: id }),
})

export const NodeUpdated = AuditAction.define({
  code: 'org.node.update',
  target: 'org.node',
  version: 1,
  name: text(m.audit_nodeUpdate),
  details: Schema.Struct({ fields: Schema.Array(Schema.Literals(['name', 'sortOrder'])) }),
})

export const NodeMoved = AuditAction.define({
  code: 'org.node.move',
  target: 'org.node',
  version: 1,
  name: text(m.audit_nodeMove),
  details: Schema.Struct({ fromParentId: id, toParentId: id }),
})

export const NodeRetyped = AuditAction.define({
  code: 'org.node.retype',
  target: 'org.node',
  version: 1,
  name: text(m.audit_nodeRetype),
  details: Schema.Struct({ fromOrgTypeId: id, toOrgTypeId: id }),
})

export const NodeDeleted = AuditAction.define({
  code: 'org.node.delete',
  target: 'org.node',
  version: 1,
  name: text(m.audit_nodeDelete),
  details: Schema.Struct({}),
})

export const NodeRestored = AuditAction.define({
  code: 'org.node.restore',
  target: 'org.node',
  version: 1,
  name: text(m.audit_nodeRestore),
  details: Schema.Struct({}),
})

export const TypeCreated = AuditAction.define({
  code: 'org.type.create',
  target: 'org.type',
  version: 1,
  name: text(m.audit_typeCreate),
  details: Schema.Struct({}),
})

export const TypeUpdated = AuditAction.define({
  code: 'org.type.update',
  target: 'org.type',
  version: 1,
  name: text(m.audit_typeUpdate),
  details: Schema.Struct({ fields: Schema.Array(Schema.Literals(['name', 'sortOrder'])) }),
})

export const TypeDeleted = AuditAction.define({
  code: 'org.type.delete',
  target: 'org.type',
  version: 1,
  name: text(m.audit_typeDelete),
  details: Schema.Struct({}),
})

export const RulePut = AuditAction.define({
  code: 'org.type-rule.update',
  target: 'org.type-rule',
  version: 1,
  name: text(m.audit_rulePut),
  details: Schema.Struct({ parentTypeId: id, childTypeId: id }),
})

export const RuleDeleted = AuditAction.define({
  code: 'org.type-rule.delete',
  target: 'org.type-rule',
  version: 1,
  name: text(m.audit_ruleDelete),
  details: Schema.Struct({ parentTypeId: id, childTypeId: id }),
})

export const orgActions = [
  NodeCreated,
  NodeUpdated,
  NodeMoved,
  NodeRetyped,
  NodeDeleted,
  NodeRestored,
  TypeCreated,
  TypeUpdated,
  TypeDeleted,
  RulePut,
  RuleDeleted,
] as const
