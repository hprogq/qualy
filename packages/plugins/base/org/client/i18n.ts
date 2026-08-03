import { defineErrorMessages, defineMessage, type PluginCatalogs } from '@qualy/i18n-contract'
import type { CommonErrorCode, MessageDescriptor } from '@qualy/i18n-contract'
import type { ApiErrorCode } from '@qualy/i18n-contract'
import type { OrgContractError } from '../src/contract.ts'
import { orgNavigationLabel } from '../src/messages.ts'

// the org plugin owns the org/* message namespace: page copy plus a
// localization for every typed api error it can raise. English lives in the
// defaultMessage, translations in the per-locale catalogs.

// the only org message that interpolates: its placeholders are declared,
// so a formatter call missing assignmentCount fails typecheck
export const assignmentIncompatibleMessage = defineMessage<{ assignmentCount: number }>()({
  id: 'org/error/assignment-incompatible',
  defaultMessage:
    '{assignmentCount, plural, one {# role assignment does} other {# role assignments do}} not allow the new organization type.',
})

export const orgMessages = {
  loadFailedTitle: { id: 'org/state/load-failed', defaultMessage: 'Could not load organization data' },
  loadFailedHint: {
    id: 'org/state/load-failed-hint',
    defaultMessage: 'Check your connection or permissions and try again.',
  },
  treeTitle: { id: 'org/tree/title', defaultMessage: 'Organization tree' },
  treeEmpty: { id: 'org/tree/empty', defaultMessage: 'No organization nodes are visible to you.' },
  selectHint: { id: 'org/tree/select-hint', defaultMessage: 'Select a node on the left to see its details.' },
  readOnly: { id: 'org/node/read-only', defaultMessage: 'You may only view this node.' },
  unknownType: { id: 'org/type/unknown', defaultMessage: 'Unknown type' },
  nameLabel: { id: 'org/node/name', defaultMessage: 'Name' },
  rename: { id: 'org/node/rename', defaultMessage: 'Rename' },
  nodeType: { id: 'org/node/type', defaultMessage: 'Node type' },
  changeType: { id: 'org/node/change-type', defaultMessage: 'Change type' },
  createChild: { id: 'org/node/create-child', defaultMessage: 'New child node' },
  namePlaceholder: { id: 'org/node/name-placeholder', defaultMessage: 'Name' },
  selectType: { id: 'org/type/select', defaultMessage: 'Select a type' },
  create: { id: 'org/action/create', defaultMessage: 'Create' },
  moveTo: { id: 'org/node/move-to', defaultMessage: 'Move to' },
  selectParent: { id: 'org/node/select-parent', defaultMessage: 'Select a new parent node' },
  move: { id: 'org/action/move', defaultMessage: 'Move' },
  deleteNode: { id: 'org/action/delete-node', defaultMessage: 'Delete node' },
  typesTitle: { id: 'org/type/title', defaultMessage: 'Organization types' },
  rulesTitle: { id: 'org/rule/title', defaultMessage: 'Hierarchy rules' },
  codePlaceholder: { id: 'org/type/code-placeholder', defaultMessage: 'code (lowercase kebab-case)' },
  parentType: { id: 'org/rule/parent-type', defaultMessage: 'Parent type' },
  childType: { id: 'org/rule/child-type', defaultMessage: 'Child type' },
  delete: { id: 'org/action/delete', defaultMessage: 'Delete' },
} as const satisfies Record<string, MessageDescriptor>

// codes this plugin owns: everything its contract defines minus the
// transport-level codes the runtime localizes centrally
type OrgOwnedErrorCode = Exclude<ApiErrorCode<OrgContractError>, CommonErrorCode>

// every owned code must appear, no foreign code is accepted, and each
// values() receives exactly that code's data type
// error copy as a literal table so the catalog key set can be derived
export const orgErrorTexts = {
  assignmentIncompatible: assignmentIncompatibleMessage,
  typeNotFound: { id: 'org/error/type-not-found', defaultMessage: 'Organization type not found.' },
  ruleNotFound: { id: 'org/error/rule-not-found', defaultMessage: 'Hierarchy rule not found.' },
  nodeNotFound: { id: 'org/error/node-not-found', defaultMessage: 'Organization node not found.' },
  typeConflict: { id: 'org/error/type-conflict', defaultMessage: 'An organization type with that code or name already exists.' },
  ruleConflict: { id: 'org/error/rule-conflict', defaultMessage: 'That hierarchy rule already exists.' },
  nodeConflict: { id: 'org/error/node-conflict', defaultMessage: 'A sibling node with that name or code already exists.' },
  typeInUse: { id: 'org/error/type-in-use', defaultMessage: 'This organization type is still referenced and cannot be removed.' },
  ruleInUse: { id: 'org/error/rule-in-use', defaultMessage: 'Existing nodes depend on this rule, so it cannot be removed.' },
  nodeInUse: { id: 'org/error/node-in-use', defaultMessage: 'Users or role assignments still reference this node.' },
  nodeIsRoot: { id: 'org/error/node-is-root', defaultMessage: 'The root node cannot be moved or deleted.' },
  nodeHasChildren: { id: 'org/error/node-has-children', defaultMessage: 'Only nodes without children can be deleted.' },
  ruleInvalid: { id: 'org/error/rule-invalid', defaultMessage: 'That hierarchy rule is not valid.' },
  ruleCycle: { id: 'org/error/rule-cycle', defaultMessage: 'That rule would create a cycle in the type hierarchy.' },
  nodeRuleViolation: { id: 'org/error/rule-violation', defaultMessage: 'The hierarchy rules forbid this parent and child type combination.' },
  nodeInvalidMove: { id: 'org/error/invalid-move', defaultMessage: 'A node cannot be moved into itself or its own subtree.' },
} as const satisfies Record<string, MessageDescriptor>

// every owned code must appear, no foreign code is accepted, and each
// values() receives exactly that code's data type
export const errorMessages = defineErrorMessages<OrgContractError, OrgOwnedErrorCode>()({
  ORG_TYPE_NOT_FOUND: { message: orgErrorTexts.typeNotFound },
  ORG_RULE_NOT_FOUND: { message: orgErrorTexts.ruleNotFound },
  ORG_NODE_NOT_FOUND: { message: orgErrorTexts.nodeNotFound },
  ORG_TYPE_CONFLICT: { message: orgErrorTexts.typeConflict },
  ORG_RULE_CONFLICT: { message: orgErrorTexts.ruleConflict },
  ORG_NODE_CONFLICT: { message: orgErrorTexts.nodeConflict },
  ORG_TYPE_IN_USE: { message: orgErrorTexts.typeInUse },
  ORG_RULE_IN_USE: { message: orgErrorTexts.ruleInUse },
  ORG_NODE_IN_USE: { message: orgErrorTexts.nodeInUse },
  ORG_NODE_IS_ROOT: { message: orgErrorTexts.nodeIsRoot },
  ORG_NODE_HAS_CHILDREN: { message: orgErrorTexts.nodeHasChildren },
  ORG_NODE_ASSIGNMENT_INCOMPATIBLE: {
    message: assignmentIncompatibleMessage,
    // data is the contract's own type here, no cast and no default
    values: (data) => ({ assignmentCount: data.assignmentCount }),
  },
  ORG_RULE_INVALID: { message: orgErrorTexts.ruleInvalid },
  ORG_RULE_CYCLE: { message: orgErrorTexts.ruleCycle },
  ORG_NODE_RULE_VIOLATION: { message: orgErrorTexts.nodeRuleViolation },
  ORG_NODE_INVALID_MOVE: { message: orgErrorTexts.nodeInvalidMove },
})

// every message this plugin declares, in one table: the catalogs derive
// their exact key set from it and the runtime reads it for completeness
export const orgDeclaredMessages = {
  navigation: orgNavigationLabel,
  ...orgMessages,
  ...orgErrorTexts,
} as const satisfies Record<string, MessageDescriptor>

export const catalogs: PluginCatalogs = {
  namespace: 'org',
  messages: Object.values(orgDeclaredMessages),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
}
