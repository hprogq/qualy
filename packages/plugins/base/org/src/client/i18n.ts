import { defineErrorTranslations, type ErrorsByCode } from '@qualy/i18n-contract'
import type * as orgErrors from '../server/errors.ts'
import type { Message } from '@qualy/i18n-contract'
import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

export const errorMessages = defineErrorTranslations<ErrorsByCode<typeof orgErrors>>()({
  ORG_TYPE_NOT_FOUND: m.error_typeNotFound,
  ORG_RULE_NOT_FOUND: m.error_ruleNotFound,
  ORG_NODE_NOT_FOUND: m.error_nodeNotFound,
  ORG_TYPE_CONFLICT: m.error_typeConflict,
  ORG_NODE_CONFLICT: m.error_nodeConflict,
  ORG_TYPE_IN_USE: {
    message: m.error_typeInUse,
    values: (data) => ({ where: data.reason === 'deleted-nodes' ? 'bin' : 'tree' }),
  },
  ORG_RULE_IN_USE: m.error_ruleInUse,
  ORG_NODE_IN_USE: m.error_nodeInUse,
  ORG_NODE_IS_ROOT: m.error_nodeIsRoot,
  ORG_NODE_PARENT_DELETED: m.error_nodeParentDeleted,
  ORG_NODE_HAS_CHILDREN: m.error_nodeHasChildren,
  ORG_NODE_PLACEMENT_INCOMPATIBLE: {
    message: m.error_placementIncompatible,
    values: (data) => ({ userCount: data.userCount }),
  },
  ORG_NODE_ASSIGNMENT_INCOMPATIBLE: {
    message: m.error_assignmentIncompatible,
    // data is typed straight from the error definition's schema
    values: (data) => ({ assignmentCount: data.assignmentCount }),
  },
  ORG_RULE_INVALID: m.error_ruleInvalid,
  ORG_RULE_CYCLE: m.error_ruleCycle,
  ORG_NODE_RULE_VIOLATION: m.error_ruleViolation,
  ORG_NODE_INVALID_MOVE: m.error_invalidMove,
}).registry

// the messages the server names over the wire, by the id it sends
export const wireMessages: Record<string, Message> = {
  'org/audit/node-create': m.audit_nodeCreate,
  'org/audit/node-delete': m.audit_nodeDelete,
  'org/audit/node-move': m.audit_nodeMove,
  'org/audit/node-restore': m.audit_nodeRestore,
  'org/audit/node-retype': m.audit_nodeRetype,
  'org/audit/node-update': m.audit_nodeUpdate,
  'org/audit/rule-delete': m.audit_ruleDelete,
  'org/audit/rule-put': m.audit_rulePut,
  'org/audit/type-create': m.audit_typeCreate,
  'org/audit/type-delete': m.audit_typeDelete,
  'org/audit/type-update': m.audit_typeUpdate,
  'org/nav-group/organization': m.navGroup_organization,
  'org/navigation/organization': m.navigation_organization,
  'org/permission-group/structure': m.permissionGroup_structure,
  'org/permission/tree-manage': m.permission_treeManage,
  'org/permission/tree-read': m.permission_treeRead,
}
