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

const peopleCountMessage = defineMessage<{ count: number }>()({
  id: 'org/nodes/people-count',
  defaultMessage: '{count, plural, =0 {nobody} one {# person} other {# people}}',
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
    // one label per audit action this plugin declares
    'audit.org.node.create': {
      id: 'org/audit/node-create',
      defaultMessage: 'Create organization unit',
    },
    'audit.org.node.update': {
      id: 'org/audit/node-update',
      defaultMessage: 'Edit organization unit',
    },
    'audit.org.node.move': { id: 'org/audit/node-move', defaultMessage: 'Move organization unit' },
    'audit.org.node.retype': {
      id: 'org/audit/node-retype',
      defaultMessage: 'Change an organization unit type',
    },
    'audit.org.node.delete': {
      id: 'org/audit/node-delete',
      defaultMessage: 'Delete organization unit',
    },
    'audit.org.type.create': {
      id: 'org/audit/type-create',
      defaultMessage: 'Create organization type',
    },
    'audit.org.type.update': {
      id: 'org/audit/type-update',
      defaultMessage: 'Edit organization type',
    },
    'audit.org.type.delete': {
      id: 'org/audit/type-delete',
      defaultMessage: 'Delete organization type',
    },
    'audit.org.type-rule.update': {
      id: 'org/audit/rule-put',
      defaultMessage: 'Allow a parent-child type pairing',
    },
    'audit.org.type-rule.delete': {
      id: 'org/audit/rule-delete',
      defaultMessage: 'Forbid a parent-child type pairing',
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
    treeTitle: { id: 'org/tree/title', defaultMessage: 'Organization' },
    treeEmpty: {
      id: 'org/tree/empty',
      defaultMessage: 'No organization nodes are visible to you.',
    },
    selectHint: {
      id: 'org/tree/select-hint',
      defaultMessage: 'Open a unit to see its details.',
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
    parentType: { id: 'org/rule/parent-type', defaultMessage: 'Parent type' },
    childType: { id: 'org/rule/child-type', defaultMessage: 'Child type' },
    delete: { id: 'org/action/delete', defaultMessage: 'Delete' },
    structureHint: {
      id: 'org/page/structure-hint',
      defaultMessage: 'Maintain the name, the parent and the children of a unit.',
    },
    typesHint: {
      id: 'org/page/types-hint',
      defaultMessage: 'Types decide which units may hold which; creating and moving follow them.',
    },
    viewStructure: { id: 'org/view/structure', defaultMessage: 'Structure' },
    viewTypes: { id: 'org/view/types', defaultMessage: 'Types' },
    searchPlaceholder: { id: 'org/tree/search', defaultMessage: 'Search units' },
    searchEmpty: { id: 'org/tree/search-empty', defaultMessage: 'No unit matches the search.' },
    unitCount: {
      id: 'org/tree/unit-count',
      defaultMessage: '{count, plural, one {# unit} other {# units}}',
    },
    parentLabel: { id: 'org/node/parent', defaultMessage: 'Parent' },
    pathLabel: { id: 'org/node/path', defaultMessage: 'Position' },
    siblingRank: { id: 'org/node/sibling-rank', defaultMessage: '{rank} of {total}' },
    rankLabel: { id: 'org/node/rank', defaultMessage: 'Rank among siblings' },
    childrenTitle: { id: 'org/node/children', defaultMessage: 'Children' },
    childCount: {
      id: 'org/node/child-count',
      defaultMessage: '{count, plural, one {# child} other {# children}}',
    },
    open: { id: 'org/action/open', defaultMessage: 'Open' },
    allowedHere: { id: 'org/node/allowed-here', defaultMessage: 'May hold: {types}' },
    noChildrenAllowed: {
      id: 'org/node/no-children-allowed',
      defaultMessage: 'This kind of unit holds no children.',
    },
    childrenEmpty: { id: 'org/node/children-empty', defaultMessage: 'No children yet.' },
    peopleTitle: { id: 'org/nodes/people', defaultMessage: 'People' },
    peopleHint: {
      id: 'org/nodes/people-hint',
      defaultMessage: 'The roster is maintained on the users screen.',
    },
    peopleOpen: { id: 'org/nodes/people-open', defaultMessage: 'Open the roster' },
    pickNodeTitle: { id: 'org/nodes/pick-title', defaultMessage: 'Open a unit' },
    pickNodeBody: {
      id: 'org/nodes/pick-body',
      defaultMessage: 'Its name, its place and the units under it are maintained here.',
    },
    pickTypeTitle: { id: 'org/types/pick-title', defaultMessage: 'Open a kind of unit' },
    pickTypeBody: {
      id: 'org/types/pick-body',
      defaultMessage: 'Which kinds may sit under which is set here.',
    },
    peopleCount: peopleCountMessage,
    deleteTitle: { id: 'org/node/delete-title', defaultMessage: 'Delete this unit' },
    deleteBlockedChildren: {
      id: 'org/node/delete-blocked-children',
      defaultMessage:
        'Move or delete {count, plural, one {its # child} other {its # children}} first.',
    },
    confirmDeleteNode: {
      id: 'org/node/confirm-delete',
      defaultMessage: 'Delete "{name}"?',
    },
    confirmDeleteNodeBody: {
      id: 'org/node/confirm-delete-body',
      defaultMessage: 'People and role grants attached to it will block the deletion.',
    },
    typeListEmpty: { id: 'org/type/list-empty', defaultMessage: 'No organization types yet.' },
    typeNodeCount: {
      id: 'org/type/node-count',
      defaultMessage: '{count, plural, one {# unit} other {# units}}',
    },
    allowedChildrenTitle: { id: 'org/type/allowed-children', defaultMessage: 'Allowed children' },
    allowedChildrenHint: {
      id: 'org/type/allowed-children-hint',
      defaultMessage: 'Ticked types can be created and moved under units of this type.',
    },
    saveRules: { id: 'org/type/save-rules', defaultMessage: 'Save' },
    allowedUnder: { id: 'org/type/allowed-under', defaultMessage: 'Allowed under' },
    allowedUnderNone: {
      id: 'org/type/allowed-under-none',
      defaultMessage: 'No type accepts it as a child yet.',
    },
    typeInUseHint: {
      id: 'org/type/in-use-hint',
      defaultMessage: '{count, plural, one {# unit uses} other {# units use}} this type.',
    },
    confirmDeleteType: { id: 'org/type/confirm-delete', defaultMessage: 'Delete "{name}"?' },
    confirmDeleteTypeBody: {
      id: 'org/type/confirm-delete-body',
      defaultMessage: 'Its hierarchy rules go with it.',
    },
    newTypeTitle: { id: 'org/type/new', defaultMessage: 'New type' },
    saved: { id: 'org/state/saved', defaultMessage: 'Saved.' },
    save: { id: 'org/action/save', defaultMessage: 'Save' },
    expandAll: { id: 'org/tree/expand-all', defaultMessage: 'Expand all' },
    manageableCount: {
      id: 'org/tree/manageable-count',
      defaultMessage: '{count} you may manage',
    },
    chosenCount: { id: 'org/type/chosen-count', defaultMessage: '{count} chosen' },
    handleOneByOne: { id: 'org/node/handle-one-by-one', defaultMessage: 'Open the first' },
    deleteChecksServer: {
      id: 'org/node/delete-checks-server',
      defaultMessage: 'People and role grants are checked when you delete.',
    },
    typeFreeHint: { id: 'org/type/free-hint', defaultMessage: 'No unit uses this type.' },
    ladderTitle: { id: 'org/type/ladder', defaultMessage: 'Hierarchy' },
    ladderEmpty: { id: 'org/type/ladder-empty', defaultMessage: 'No rules yet.' },
    ruleCount: {
      id: 'org/type/rule-count',
      defaultMessage: '{count, plural, one {# rule} other {# rules}}',
    },
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
