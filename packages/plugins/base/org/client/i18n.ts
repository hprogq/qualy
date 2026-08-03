import type {
  ErrorMessageMap,
  MessageDescriptor,
  PluginCatalogs,
} from '@qualy/i18n-contract'
import type { orgErrorStatuses } from '../src/contract.ts'
import { orgNavigationLabel } from '../src/messages.ts'

// the org plugin owns the org/* message namespace: page copy plus a
// localization for every typed api error it can raise. English lives in the
// defaultMessage, translations in the per-locale catalogs.

const define = <T extends Record<string, MessageDescriptor>>(messages: T) => messages

export const orgMessages = define({
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
})

type OrgErrorCode = Exclude<keyof typeof orgErrorStatuses, 'AUTH_REQUIRED'>

export const errorMessages = {
  ORG_TYPE_NOT_FOUND: {
    message: { id: 'org/error/type-not-found', defaultMessage: 'Organization type not found.' },
  },
  ORG_RULE_NOT_FOUND: {
    message: { id: 'org/error/rule-not-found', defaultMessage: 'Hierarchy rule not found.' },
  },
  ORG_NODE_NOT_FOUND: {
    message: { id: 'org/error/node-not-found', defaultMessage: 'Organization node not found.' },
  },
  ORG_TYPE_CONFLICT: {
    message: {
      id: 'org/error/type-conflict',
      defaultMessage: 'An organization type with that code or name already exists.',
    },
  },
  ORG_RULE_CONFLICT: {
    message: { id: 'org/error/rule-conflict', defaultMessage: 'That hierarchy rule already exists.' },
  },
  ORG_NODE_CONFLICT: {
    message: {
      id: 'org/error/node-conflict',
      defaultMessage: 'A sibling node with that name or code already exists.',
    },
  },
  ORG_TYPE_IN_USE: {
    message: {
      id: 'org/error/type-in-use',
      defaultMessage: 'This organization type is still referenced and cannot be removed.',
    },
  },
  ORG_RULE_IN_USE: {
    message: {
      id: 'org/error/rule-in-use',
      defaultMessage: 'Existing nodes depend on this rule, so it cannot be removed.',
    },
  },
  ORG_NODE_IN_USE: {
    message: {
      id: 'org/error/node-in-use',
      defaultMessage: 'Users or role assignments still reference this node.',
    },
  },
  ORG_NODE_IS_ROOT: {
    message: {
      id: 'org/error/node-is-root',
      defaultMessage: 'The root node cannot be moved or deleted.',
    },
  },
  ORG_NODE_HAS_CHILDREN: {
    message: {
      id: 'org/error/node-has-children',
      defaultMessage: 'Only nodes without children can be deleted.',
    },
  },
  ORG_NODE_ASSIGNMENT_INCOMPATIBLE: {
    message: {
      id: 'org/error/assignment-incompatible',
      defaultMessage:
        '{assignmentCount, plural, one {# role assignment does} other {# role assignments do}} not allow the new organization type.',
    },
    values: (data: unknown) => ({
      assignmentCount: (data as { assignmentCount?: number } | undefined)?.assignmentCount ?? 0,
    }),
  },
  ORG_RULE_INVALID: {
    message: { id: 'org/error/rule-invalid', defaultMessage: 'That hierarchy rule is not valid.' },
  },
  ORG_RULE_CYCLE: {
    message: {
      id: 'org/error/rule-cycle',
      defaultMessage: 'That rule would create a cycle in the type hierarchy.',
    },
  },
  ORG_NODE_RULE_VIOLATION: {
    message: {
      id: 'org/error/rule-violation',
      defaultMessage: 'The hierarchy rules forbid this parent and child type combination.',
    },
  },
  ORG_NODE_INVALID_MOVE: {
    message: {
      id: 'org/error/invalid-move',
      defaultMessage: 'A node cannot be moved into itself or its own subtree.',
    },
  },
} satisfies Record<OrgErrorCode, ErrorMessageMap[string]>

export const catalogs: PluginCatalogs = {
  namespace: 'org',
  messages: [
    orgNavigationLabel,
    ...Object.values(orgMessages),
    ...Object.values(errorMessages).map((entry) => entry.message),
  ],
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
}
