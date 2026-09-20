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

const binWhereMessage = defineMessage<{ parent: string; when: string }>()({
  id: 'org/bin/where',
  defaultMessage: 'Under {parent}, deleted {when}',
})
const peopleCountMessage = defineMessage<{ count: number }>()({
  id: 'org/nodes/people-count',
  defaultMessage: '{count, plural, =0 {nobody} one {# person} other {# people}}',
})

const moveNowhereMessage = defineMessage<{ type: string }>()({
  id: 'org/node/move-nowhere',
  defaultMessage:
    'As the rules stand, no other unit may hold a {type}. Let another kind of unit hold it, and the places of that kind appear here.',
})
const rowAddBarredMessage = defineMessage<{ type: string }>()({
  id: 'org/tree/row-add-barred',
  defaultMessage: 'The rules let nothing stand under a {type}',
})
const namedTask = (id: string, defaultMessage: string) =>
  defineMessage<{ name: string }>()({ id, defaultMessage })
const holdChildrenMessage = defineMessage<{ count: number }>()({
  id: 'org/node/hold-children',
  defaultMessage:
    '{count, plural, one {# unit} other {# units}} under it: move or remove them first',
})
const holdLineMessage = defineMessage<{ label: string; count: number }>()({
  id: 'org/node/hold-line',
  defaultMessage: '{label}: {count}',
})
const holdExamplesMoreMessage = defineMessage<{ names: string }>()({
  id: 'org/node/hold-examples-more',
  defaultMessage: '{names} and more',
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
    'audit.org.node.restore': {
      id: 'org/audit/node-restore',
      defaultMessage: 'Restore organization unit',
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
    loadFailedHint: {
      id: 'org/state/load-failed-hint',
      defaultMessage: 'Check your connection or permissions and try again.',
    },
    unitsTitle: { id: 'org/tree/units', defaultMessage: 'Units' },
    treeCounts: {
      id: 'org/tree/counts',
      defaultMessage: '{total} in all, {manageable} you can change',
    },
    peopleHere: {
      id: 'org/nodes/people-here',
      defaultMessage: 'People here',
    },
    countUnits: {
      id: 'org/node/count-units',
      defaultMessage: '{count}',
    },
    typeColumn: {
      id: 'org/node/type-column',
      defaultMessage: 'Type',
    },
    childrenColumn: {
      id: 'org/node/children-column',
      defaultMessage: 'Under it',
    },
    ruleArrowHint: {
      id: 'org/rule/arrow-hint',
      defaultMessage: 'An arrow runs from a type to each type it may hold',
    },
    ruleGraphTitle: {
      id: 'org/rule/graph-title',
      defaultMessage: 'The hierarchy rules between organization types',
    },
    ruleLegendNear: {
      id: 'org/rule/legend-near',
      defaultMessage: 'A rule between neighbouring levels',
    },
    ruleLegendCross: {
      id: 'org/rule/legend-cross',
      defaultMessage: 'A rule that skips a level',
    },
    zoomIn: { id: 'org/rules/zoom-in', defaultMessage: 'Zoom in' },
    zoomOut: { id: 'org/rules/zoom-out', defaultMessage: 'Zoom out' },
    zoomFit: { id: 'org/rules/zoom-fit', defaultMessage: 'Fit to width' },
    typeInvolvedRules: {
      id: 'org/type/involved-rules',
      defaultMessage: '{count, plural, one {In # hierarchy rule} other {In # hierarchy rules}}',
    },
    unsaved: {
      id: 'org/state/unsaved',
      defaultMessage: 'Unsaved changes',
    },
    discard: {
      id: 'org/action/discard',
      defaultMessage: 'Discard',
    },
    allowedUnderHint: {
      id: 'org/type/allowed-under-hint',
      defaultMessage: 'Decided where the holding type lists what it may hold; change it there',
    },
    typeCountColumn: {
      id: 'org/type/count-column',
      defaultMessage: 'Units',
    },
    typeDeleteTitle: {
      id: 'org/type/delete-title',
      defaultMessage: 'Delete type',
    },
    none: {
      id: 'org/type/none',
      defaultMessage: 'None',
    },
    noneTopKind: {
      id: 'org/type/none-top',
      defaultMessage: 'None, a top type',
    },
    treeTitle: { id: 'org/tree/title', defaultMessage: 'Organization' },
    treeEmpty: {
      id: 'org/tree/empty',
      defaultMessage: 'No organization nodes are visible to you.',
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
    parentLabel: { id: 'org/node/parent', defaultMessage: 'Parent' },
    pathLabel: { id: 'org/node/path', defaultMessage: 'Position' },
    siblingRank: { id: 'org/node/sibling-rank', defaultMessage: '{rank} of {total}' },
    rankLabel: { id: 'org/node/rank', defaultMessage: 'Rank among siblings' },
    childrenTitle: { id: 'org/node/children', defaultMessage: 'Children' },
    allowedHere: { id: 'org/node/allowed-here', defaultMessage: 'May hold: {types}' },
    noChildrenAllowed: {
      id: 'org/node/no-children-allowed',
      defaultMessage: 'This kind of unit holds no children.',
    },
    childrenEmpty: { id: 'org/node/children-empty', defaultMessage: 'No children yet.' },
    peopleTitle: { id: 'org/nodes/people', defaultMessage: 'People' },
    peopleOpen: { id: 'org/nodes/people-open', defaultMessage: 'Open the roster' },
    peopleCount: peopleCountMessage,
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
      defaultMessage:
        'Ticked types can be created and moved under units of this type. Unticking one that units already use is refused on save',
    },
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
    save: { id: 'org/action/save', defaultMessage: 'Save' },
    expandAll: { id: 'org/tree/expand-all', defaultMessage: 'Expand all' },
    createUnder: namedTask('org/node/create-under', 'New unit under {name}'),
    renameNamed: namedTask('org/node/rename-named', 'Rename {name}'),
    moveNamed: namedTask('org/node/move-named', 'Move {name} to'),
    moveBarredSelf: { id: 'org/node/move-barred-self', defaultMessage: 'the unit being moved' },
    moveBarredBelow: {
      id: 'org/node/move-barred-below',
      defaultMessage: 'under the unit being moved',
    },
    moveNowhere: moveNowhereMessage,
    moveNowhereTitle: {
      id: 'org/node/move-nowhere-title',
      defaultMessage: 'There is nowhere to move it',
    },
    moveNowhereRules: {
      id: 'org/node/move-nowhere-rules',
      defaultMessage: 'See the rules for this kind',
    },
    moveBarredCurrent: { id: 'org/node/move-barred-current', defaultMessage: 'its parent now' },
    moveBarredType: { id: 'org/node/move-barred-type', defaultMessage: 'cannot hold this kind' },
    moveBarredReach: { id: 'org/node/move-barred-reach', defaultMessage: 'not yours to manage' },
    moveConsequence: {
      id: 'org/node/move-consequence',
      defaultMessage:
        'Everything under it moves along, and so does who administers it and its people',
    },
    rowAdd: namedTask('org/tree/row-add', 'New unit under {name}'),
    rowAddBarred: rowAddBarredMessage,
    rowMore: namedTask('org/tree/row-more', 'More for {name}'),
    rowOpen: { id: 'org/tree/row-open', defaultMessage: 'Details' },
    collapseAll: { id: 'org/tree/collapse-all', defaultMessage: 'Collapse all' },
    holdNoChildren: { id: 'org/node/hold-no-children', defaultMessage: 'No units under it' },
    holdChildren: holdChildrenMessage,
    holdNothingElse: {
      id: 'org/node/hold-nothing-else',
      defaultMessage: 'Nothing else in the product points at it',
    },
    holdUnknown: {
      id: 'org/node/hold-unknown',
      defaultMessage: 'What else is using this unit could not be read.',
    },
    holdLine: holdLineMessage,
    holdExamplesMore: holdExamplesMoreMessage,
    holdGo: { id: 'org/node/hold-go', defaultMessage: 'Go there' },
    binTitle: { id: 'org/bin/title', defaultMessage: 'Recycle bin' },
    binHint: {
      id: 'org/bin/hint',
      defaultMessage: 'Deleted units are kept here and go back where they stood',
    },
    binEmpty: { id: 'org/bin/empty', defaultMessage: 'Nothing has been deleted' },
    binWhere: binWhereMessage,
    binParentFirst: {
      id: 'org/bin/parent-first',
      defaultMessage: 'Restore the unit it stood under first',
    },
    binRestore: { id: 'org/bin/restore', defaultMessage: 'Restore' },
    holdVerdictClear: {
      id: 'org/node/hold-verdict-clear',
      defaultMessage: 'Nothing stands on this unit. It goes to the bin and can be restored.',
    },
    holdVerdictHeld: {
      id: 'org/node/hold-verdict-held',
      defaultMessage: 'Clear every line above before this unit can be removed.',
    },
    // the twistie's spoken name; the unit's own name is appended to it, so
    // a screen reader hears which branch is being folded
    foldBranch: { id: 'org/tree/fold-branch', defaultMessage: 'Fold or unfold' },
    typeIsRootHint: {
      id: 'org/types/is-root-hint',
      defaultMessage:
        'This is the kind of the root unit, which always exists, so it cannot be deleted.',
    },
    typeFreeHint: { id: 'org/type/free-hint', defaultMessage: 'No unit uses this type.' },
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
    ORG_NODE_PARENT_DELETED: {
      id: 'org/error/node-parent-deleted',
      defaultMessage: 'The unit it stood under has been deleted too. Restore that one first.',
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
      // data is typed straight from the error definition's schema
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
