import {
  defineErrorTranslations,
  defineMessage,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as orgErrors from '../server/errors.ts'

// everything the org plugin says to a human, declared once: page copy plus
// a translation for every error its contract can raise. English lives in
// the defaultMessage, other languages in the locale catalogs; the runtime
// registry, the declared-descriptor table and the aggregated catalogs are
// all derived from this call.

// the one message that interpolates declares its placeholders: both a
// format() call and this translation's projection must produce exactly
// assignmentCount, checked at compile time
const placementIncompatible = defineMessage<{ userCount: number }>()({
  id: 'org/error/placement-incompatible',
  defaultMessage:
    '{userCount, plural, one {# person stands here and} other {# people stand here and}} may not be placed on that organization type.',
})

const assignmentIncompatible = defineMessage<{ assignmentCount: number }>()({
  id: 'org/error/assignment-incompatible',
  defaultMessage:
    '{assignmentCount, plural, one {# role assignment does} other {# role assignments do}} not allow the new organization type.',
})

const i18n = definePluginMessages({
  namespace: 'org',
  messages: {
    // one label per permission this plugin declares. The definition
    // carries a message reference, so the role editor renders whatever
    // language its reader asked for rather than the one it was authored in.
    'permission.org.tree.read': {
      id: 'org/permission/tree-read',
      defaultMessage: 'View the organization',
    },
    'permission.org.tree.manage': {
      id: 'org/permission/tree-manage',
      defaultMessage: 'Manage the organization',
    },
    loadFailedTitle: {
      id: 'org/state/load-failed',
      defaultMessage: 'Could not load organization data',
    },
    loadFailedHint: {
      id: 'org/state/load-failed-hint',
      defaultMessage: 'Check your connection or permissions and try again.',
    },
    treeTitle: { id: 'org/tree/title', defaultMessage: 'Organization tree' },
    treeEmpty: {
      id: 'org/tree/empty',
      defaultMessage: 'No organization nodes are visible to you.',
    },
    selectHint: {
      id: 'org/tree/select-hint',
      defaultMessage: 'Select a node on the left to see its details.',
    },
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
    codePlaceholder: {
      id: 'org/type/code-placeholder',
      defaultMessage: 'code (lowercase kebab-case)',
    },
    parentType: { id: 'org/rule/parent-type', defaultMessage: 'Parent type' },
    childType: { id: 'org/rule/child-type', defaultMessage: 'Child type' },
    delete: { id: 'org/action/delete', defaultMessage: 'Delete' },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof orgErrors>>()({
    ORG_TYPE_NOT_FOUND: {
      id: 'org/error/type-not-found',
      defaultMessage: 'Organization type not found.',
    },
    ORG_RULE_NOT_FOUND: {
      id: 'org/error/rule-not-found',
      defaultMessage: 'Hierarchy rule not found.',
    },
    ORG_NODE_NOT_FOUND: {
      id: 'org/error/node-not-found',
      defaultMessage: 'Organization node not found.',
    },
    ORG_TYPE_CONFLICT: {
      id: 'org/error/type-conflict',
      defaultMessage: 'An organization type with that code or name already exists.',
    },
    ORG_NODE_CONFLICT: {
      id: 'org/error/node-conflict',
      defaultMessage: 'A sibling node with that name or code already exists.',
    },
    ORG_TYPE_IN_USE: {
      id: 'org/error/type-in-use',
      defaultMessage: 'This organization type is still referenced and cannot be removed.',
    },
    ORG_RULE_IN_USE: {
      id: 'org/error/rule-in-use',
      defaultMessage: 'Existing nodes depend on this rule, so it cannot be removed.',
    },
    ORG_NODE_IN_USE: {
      id: 'org/error/node-in-use',
      defaultMessage: 'Users or role assignments still reference this node.',
    },
    ORG_NODE_IS_ROOT: {
      id: 'org/error/node-is-root',
      defaultMessage: 'The root node cannot be moved or deleted.',
    },
    ORG_NODE_HAS_CHILDREN: {
      id: 'org/error/node-has-children',
      defaultMessage: 'Only nodes without children can be deleted.',
    },
    ORG_NODE_PLACEMENT_INCOMPATIBLE: {
      message: placementIncompatible,
      values: (data) => ({ userCount: data.userCount }),
    },
    ORG_NODE_ASSIGNMENT_INCOMPATIBLE: {
      message: assignmentIncompatible,
      // data is typed straight from the error definition's zod schema
      values: (data) => ({ assignmentCount: data.assignmentCount }),
    },
    ORG_RULE_INVALID: {
      id: 'org/error/rule-invalid',
      defaultMessage: 'That hierarchy rule is not valid.',
    },
    ORG_RULE_CYCLE: {
      id: 'org/error/rule-cycle',
      defaultMessage: 'That rule would create a cycle in the type hierarchy.',
    },
    ORG_NODE_RULE_VIOLATION: {
      id: 'org/error/rule-violation',
      defaultMessage: 'The hierarchy rules forbid this parent and child type combination.',
    },
    ORG_NODE_INVALID_MOVE: {
      id: 'org/error/invalid-move',
      defaultMessage: 'A node cannot be moved into itself or its own subtree.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const orgMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
