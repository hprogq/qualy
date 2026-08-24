import { Schema } from 'effect'
import { message } from '@qualy/i18n-contract'
import { AuditAction } from '@qualy/audit-contract/action'

// The organization domain's audit actions: pure constants, like
// ./permissions. Details carry ids and field names, never the values - what
// changed is the event's business, what it changed TO is the row's.

const id = Schema.String

export const NodeCreated = AuditAction.define({
  code: 'org.node.create',
  target: 'org.node',
  version: 1,
  name: message('org/audit/node-create', 'Create organization unit'),
  details: Schema.Struct({ parentId: id, orgTypeId: id }),
})

export const NodeUpdated = AuditAction.define({
  code: 'org.node.update',
  target: 'org.node',
  version: 1,
  name: message('org/audit/node-update', 'Edit organization unit'),
  details: Schema.Struct({ fields: Schema.Array(Schema.Literals(['name', 'sortOrder'])) }),
})

export const NodeMoved = AuditAction.define({
  code: 'org.node.move',
  target: 'org.node',
  version: 1,
  name: message('org/audit/node-move', 'Move organization unit'),
  details: Schema.Struct({ fromParentId: id, toParentId: id }),
})

export const NodeRetyped = AuditAction.define({
  code: 'org.node.retype',
  target: 'org.node',
  version: 1,
  name: message('org/audit/node-retype', 'Change an organization unit type'),
  details: Schema.Struct({ fromOrgTypeId: id, toOrgTypeId: id }),
})

export const NodeDeleted = AuditAction.define({
  code: 'org.node.delete',
  target: 'org.node',
  version: 1,
  name: message('org/audit/node-delete', 'Delete organization unit'),
  details: Schema.Struct({}),
})

export const TypeCreated = AuditAction.define({
  code: 'org.type.create',
  target: 'org.type',
  version: 1,
  name: message('org/audit/type-create', 'Create organization type'),
  details: Schema.Struct({}),
})

export const TypeUpdated = AuditAction.define({
  code: 'org.type.update',
  target: 'org.type',
  version: 1,
  name: message('org/audit/type-update', 'Edit organization type'),
  details: Schema.Struct({ fields: Schema.Array(Schema.Literals(['name', 'sortOrder'])) }),
})

export const TypeDeleted = AuditAction.define({
  code: 'org.type.delete',
  target: 'org.type',
  version: 1,
  name: message('org/audit/type-delete', 'Delete organization type'),
  details: Schema.Struct({}),
})

export const RulePut = AuditAction.define({
  code: 'org.type-rule.update',
  target: 'org.type-rule',
  version: 1,
  name: message('org/audit/rule-put', 'Allow a parent-child type pairing'),
  details: Schema.Struct({ parentTypeId: id, childTypeId: id }),
})

export const RuleDeleted = AuditAction.define({
  code: 'org.type-rule.delete',
  target: 'org.type-rule',
  version: 1,
  name: message('org/audit/rule-delete', 'Forbid a parent-child type pairing'),
  details: Schema.Struct({ parentTypeId: id, childTypeId: id }),
})

export const orgActions = [
  NodeCreated,
  NodeUpdated,
  NodeMoved,
  NodeRetyped,
  NodeDeleted,
  TypeCreated,
  TypeUpdated,
  TypeDeleted,
  RulePut,
  RuleDeleted,
] as const
