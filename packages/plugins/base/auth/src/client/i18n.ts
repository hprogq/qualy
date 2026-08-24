import {
  defineErrorTranslations,
  defineMessage,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as authErrors from '../server/errors.ts'

// the interpolating messages declare their placeholders
const userCountMessage = defineMessage<{ count: number }>()({
  id: 'auth/user-types/user-count',
  defaultMessage: '{count, plural, one {# user} other {# users}}',
})
const userTypeInUseMessage = defineMessage<{ userCount: number }>()({
  id: 'auth/error/user-type-in-use',
  defaultMessage:
    '{userCount, plural, one {# user still has} other {# users still have}} this type.',
})
const userTypeLastForRoleMessage = defineMessage<{ roleCount: number }>()({
  id: 'auth/error/user-type-last-for-role',
  defaultMessage:
    '{roleCount, plural, one {# role allows} other {# roles allow}} this user type and no other.',
})
const boundCountMessage = defineMessage<{ count: number }>()({
  id: 'auth/person/bound-count',
  defaultMessage: '{count, plural, one {# entrance} other {# entrances}}',
})
const lastUsedMessage = defineMessage<{ when: string }>()({
  id: 'auth/person/last-used',
  defaultMessage: 'Last used {when}',
})
const accountCountMessage = defineMessage<{ count: number }>()({
  id: 'auth/users/account-count',
  defaultMessage: '{count, plural, one {# account} other {# accounts}}',
})
const audienceSummaryMessage = defineMessage<{ count: number }>()({
  id: 'auth/login-methods/audience-summary',
  defaultMessage: '{count, plural, =0 {no user type} one {1 user type} other {# user types}}',
})
const inUseBlockerMessage = defineMessage<{ count: number }>()({
  id: 'auth/user-types/blocker-in-use',
  defaultMessage:
    '{count, plural, one {# person holds} other {# people hold}} this type, so it can be neither disabled nor deleted.',
})
const placementCountMessage = defineMessage<{ count: number }>()({
  id: 'auth/user-types/placement-count',
  defaultMessage: '{count, plural, one {# node type} other {# node types}}',
})
const placementInUseMessage = defineMessage<{ userCount: number }>()({
  id: 'auth/error/user-type-placement-in-use',
  defaultMessage:
    '{userCount, plural, one {# user stands} other {# users stand}} where this change would no longer allow.',
})
const grantIncompatibleMessage = defineMessage<{ grantCount: number }>()({
  id: 'auth/error/grant-incompatible',
  defaultMessage:
    '{grantCount, plural, one {# role grant does} other {# role grants do}} not allow this change.',
})

const pickerChosen = defineMessage<{ count: number }>()({
  id: 'auth/picker/chosen',
  defaultMessage: '{count, plural, =0 {Nobody chosen} other {# chosen}}',
})

const pickerChosenElsewhere = defineMessage<{ count: number }>()({
  id: 'auth/picker/chosen-elsewhere',
  defaultMessage: '{count} on other pages',
})

const pickerRemove = defineMessage<{ name: string }>()({
  id: 'auth/picker/remove',
  defaultMessage: 'Remove {name}',
})

const nodeRemove = defineMessage<{ name: string }>()({
  id: 'auth/picker/node-remove',
  defaultMessage: 'Remove {name}',
})

const personRoleSubtree = defineMessage<{ node: string }>()({
  id: 'auth/person/role-subtree',
  defaultMessage: '{node} and everything under it',
})

const personRoleHere = defineMessage<{ node: string }>()({
  id: 'auth/person/role-here',
  defaultMessage: 'at {node}',
})

const i18n = definePluginMessages({
  namespace: 'auth',
  messages: {
    // one label per permission this plugin declares. The definition
    // carries a message reference, so the role editor renders whatever
    // language its reader asked for rather than the one it was authored in.
    'permission.auth.user-type.read': {
      id: 'auth/permission/user-type-read',
      defaultMessage: 'View user types',
    },
    'permission.auth.user-type.manage': {
      id: 'auth/permission/user-type-manage',
      defaultMessage: 'Manage user types',
    },
    'permission.auth.provider.read': {
      id: 'auth/permission/provider-read',
      defaultMessage: 'View login methods',
    },
    'permission.auth.provider.manage': {
      id: 'auth/permission/provider-manage',
      defaultMessage: 'Manage login methods',
    },
    'permission.auth.user.read': {
      id: 'auth/permission/user-read',
      defaultMessage: 'View users',
    },
    'permission.auth.user.manage': {
      id: 'auth/permission/user-manage',
      defaultMessage: 'Manage users',
    },
    'permission.auth.user.delete': {
      id: 'auth/permission/user-delete',
      defaultMessage: 'Delete users',
    },
    'permission.auth.user.restore': {
      id: 'auth/permission/user-restore',
      defaultMessage: 'Restore deleted users',
    },
    // one label per audit action this plugin declares; the audit screen
    // renders whatever language its reader asked for
    'audit.auth.user.create': { id: 'auth/audit/user-create', defaultMessage: 'Create user' },
    'audit.auth.user.update': { id: 'auth/audit/user-update', defaultMessage: 'Edit user' },
    'audit.auth.user.move': { id: 'auth/audit/user-move', defaultMessage: 'Move user' },
    'audit.auth.user.enable': { id: 'auth/audit/user-enable', defaultMessage: 'Enable user' },
    'audit.auth.user.disable': { id: 'auth/audit/user-disable', defaultMessage: 'Disable user' },
    'audit.auth.user.delete': { id: 'auth/audit/user-delete', defaultMessage: 'Delete user' },
    'audit.auth.user.restore': { id: 'auth/audit/user-restore', defaultMessage: 'Restore user' },
    'audit.auth.user-type.create': {
      id: 'auth/audit/user-type-create',
      defaultMessage: 'Create user type',
    },
    'audit.auth.user-type.update': {
      id: 'auth/audit/user-type-update',
      defaultMessage: 'Edit user type',
    },
    'audit.auth.user-type.enable': {
      id: 'auth/audit/user-type-enable',
      defaultMessage: 'Enable user type',
    },
    'audit.auth.user-type.disable': {
      id: 'auth/audit/user-type-disable',
      defaultMessage: 'Disable user type',
    },
    'audit.auth.user-type.placement': {
      id: 'auth/audit/user-type-placement',
      defaultMessage: 'Change where a user type may stand',
    },
    'audit.auth.user-type.delete': {
      id: 'auth/audit/user-type-delete',
      defaultMessage: 'Delete user type',
    },
    'audit.auth.provider.audience': {
      id: 'auth/audit/provider-audience',
      defaultMessage: 'Change who may sign in through an entrance',
    },
    revokeGrantTitle: {
      id: 'auth/users/revoke-grant-title',
      defaultMessage: 'Take this role away here?',
    },
    revokeGrantHint: {
      id: 'auth/users/revoke-grant-hint',
      defaultMessage: 'They keep every other role they hold. Granting it again is a separate act.',
    },
    title: { id: 'auth/login/title', defaultMessage: 'Sign in to Qualy' },

    // the card any screen opens on a name it shows
    personOpenDetail: { id: 'auth/person/open-detail', defaultMessage: 'View details' },
    personBusinessNo: { id: 'auth/person/business-no', defaultMessage: 'Student or staff ID' },
    personNoBusinessNo: { id: 'auth/person/no-business-no', defaultMessage: 'None' },
    personUserType: { id: 'auth/person/user-type', defaultMessage: 'Type' },
    personStatus: { id: 'auth/person/status', defaultMessage: 'Status' },
    personActive: { id: 'auth/person/active', defaultMessage: 'Active' },
    personDisabled: { id: 'auth/person/disabled', defaultMessage: 'Disabled' },
    personPlacement: { id: 'auth/person/placement', defaultMessage: 'Where they are' },
    personRoles: { id: 'auth/person/roles', defaultMessage: 'Roles' },
    personNoRoles: { id: 'auth/person/no-roles', defaultMessage: 'No roles yet.' },
    personRoleTenantWide: { id: 'auth/person/role-tenant-wide', defaultMessage: 'everywhere' },
    personRoleScoped: { id: 'auth/person/role-scoped', defaultMessage: 'One object only' },
    personRoleSubtree,
    personRoleHere,

    // choosing people, and choosing a slice of the organization instead
    pickerUnits: { id: 'auth/picker/units', defaultMessage: 'Organization' },
    pickerNoUnits: { id: 'auth/picker/no-units', defaultMessage: 'No units you can browse.' },
    pickerExpand: { id: 'auth/picker/expand', defaultMessage: 'Expand' },
    pickerSearch: { id: 'auth/picker/search', defaultMessage: 'Name or ID' },
    pickerAnyType: { id: 'auth/picker/any-type', defaultMessage: 'Any type' },
    pickerScopeSelf: { id: 'auth/picker/scope-self', defaultMessage: 'This unit' },
    pickerScopeSubtree: { id: 'auth/picker/scope-subtree', defaultMessage: 'And below' },
    pickerNobody: { id: 'auth/picker/nobody', defaultMessage: 'Nobody here matches.' },
    pickerAlreadyIn: { id: 'auth/picker/already-in', defaultMessage: 'Already added' },
    pickerPrevious: { id: 'auth/picker/previous', defaultMessage: 'Previous' },
    pickerNext: { id: 'auth/picker/next', defaultMessage: 'Next' },
    importUnits: { id: 'auth/picker/import-units', defaultMessage: 'Units to take people from' },
    importTypes: { id: 'auth/picker/import-types', defaultMessage: 'Kinds of person' },
    importNoTypes: { id: 'auth/picker/import-no-types', defaultMessage: 'No types available.' },
    importAllTypes: { id: 'auth/picker/import-all-types', defaultMessage: 'Select all' },
    importClearTypes: { id: 'auth/picker/import-clear-types', defaultMessage: 'Clear' },
    nodeSearch: { id: 'auth/picker/node-search', defaultMessage: 'Search units' },
    nodeKind: { id: 'auth/picker/node-kind', defaultMessage: 'Kind of unit' },
    nodeAnyKind: { id: 'auth/picker/node-any-kind', defaultMessage: 'Any kind' },
    nodeNoMatch: { id: 'auth/picker/node-no-match', defaultMessage: 'No unit matches.' },
    pickerChosen,
    pickerChosenElsewhere,
    pickerRemove,
    nodeRemove,
    methodsFailedTitle: {
      id: 'auth/login/methods-failed',
      defaultMessage: 'Could not load the sign-in methods',
    },
    methodsFailedHint: {
      id: 'auth/login/methods-failed-hint',
      defaultMessage: 'Check your connection and try again.',
    },
    noMethods: {
      id: 'auth/login/no-methods',
      defaultMessage: 'No sign-in method is available. Please contact an administrator.',
    },
    otherMethods: { id: 'auth/login/other-methods', defaultMessage: '← Other sign-in methods' },
    rendererMissing: {
      id: 'auth/login/renderer-missing',
      defaultMessage: 'This sign-in method is currently unavailable',
    },
    signIn: { id: 'auth/action/sign-in', defaultMessage: 'Sign in' },
    signOut: { id: 'auth/action/sign-out', defaultMessage: 'Sign out' },
    noBusinessNo: { id: 'auth/session/no-business-no', defaultMessage: 'No student or staff ID' },
    appearance: { id: 'auth/preference/appearance', defaultMessage: 'Appearance' },
    language: { id: 'auth/preference/language', defaultMessage: 'Language' },
    themeLight: { id: 'auth/preference/theme-light', defaultMessage: 'Light' },
    themeDark: { id: 'auth/preference/theme-dark', defaultMessage: 'Dark' },
    themeSystem: { id: 'auth/preference/theme-system', defaultMessage: 'System' },

    usersTitle: { id: 'auth/users/title', defaultMessage: 'Users' },
    usersHint: {
      id: 'auth/users/hint',
      defaultMessage: 'Maintain the roster, the types and the placements of one unit at a time.',
    },
    usersEmpty: { id: 'auth/users/empty', defaultMessage: 'No users here yet.' },
    userTypesTitle: { id: 'auth/user-types/title', defaultMessage: 'User types' },
    userTypesHint: {
      id: 'auth/user-types/hint',
      defaultMessage:
        'A user type decides how a class of people signs in and where they may belong. What they may do is decided by the roles they hold.',
    },
    userTypesEmpty: { id: 'auth/user-types/empty', defaultMessage: 'No user types yet.' },
    userTypeSelectHint: {
      id: 'auth/user-types/select-hint',
      defaultMessage: 'Open a user type to set where people of that kind may belong.',
    },
    userDetailTitle: { id: 'auth/users/detail-title', defaultMessage: 'User' },
    backToUsers: { id: 'auth/users/back', defaultMessage: '← All users' },
    profileSection: { id: 'auth/users/profile', defaultMessage: 'Profile' },
    placementSection: { id: 'auth/users/placement', defaultMessage: 'Organization placement' },
    grantsSection: { id: 'auth/users/grants', defaultMessage: 'Role grants' },
    grantsEmpty: { id: 'auth/users/grants-empty', defaultMessage: 'No role grants.' },
    tenantWideGrant: {
      id: 'auth/users/grant-tenant-wide',
      defaultMessage: 'across the whole tenant',
    },
    grantsHint: {
      id: 'auth/users/grants-hint',
      defaultMessage: 'Only grants inside what you administer are shown and editable.',
    },
    grantAdd: { id: 'auth/users/grant-add', defaultMessage: 'Grant a role' },
    grantScope: { id: 'auth/users/grant-scope', defaultMessage: 'Where it applies' },
    grantScopeTenant: {
      id: 'auth/users/grant-scope-tenant',
      defaultMessage: 'The whole tenant',
    },
    grantScopeNode: {
      id: 'auth/users/grant-scope-node',
      defaultMessage: 'One organization node',
    },
    grantCoverage: { id: 'auth/users/grant-coverage', defaultMessage: 'Reach' },
    grantCoverageSelf: { id: 'auth/users/grant-coverage-self', defaultMessage: 'That node only' },
    grantCoverageSubtree: {
      id: 'auth/users/grant-coverage-subtree',
      defaultMessage: 'That node and everything under it',
    },
    grantRole: { id: 'auth/users/grant-role', defaultMessage: 'Role' },
    grantRolesEmpty: {
      id: 'auth/users/grant-roles-empty',
      defaultMessage: 'No role you hold can be granted here.',
    },
    grantSubmit: { id: 'auth/action/grant', defaultMessage: 'Grant' },
    newUser: { id: 'auth/users/new', defaultMessage: 'New user' },
    newUserHint: {
      id: 'auth/users/new-hint',
      defaultMessage: 'The user is placed on the selected organization node.',
    },
    newUserType: { id: 'auth/user-types/new', defaultMessage: 'New user type' },
    newUserTypeHint: {
      id: 'auth/user-types/new-hint',
      defaultMessage:
        'A type is created complete: without a sign-in channel nobody holding it can sign in.',
    },
    editUserType: { id: 'auth/user-types/edit', defaultMessage: 'User type configuration' },

    nameLabel: { id: 'auth/field/name', defaultMessage: 'Name' },
    codeLabel: { id: 'auth/field/code', defaultMessage: 'Code' },
    descriptionLabel: { id: 'auth/field/description', defaultMessage: 'Description' },
    businessNoLabel: { id: 'auth/field/business-no', defaultMessage: 'Business number' },
    userTypeLabel: { id: 'auth/field/user-type', defaultMessage: 'User type' },
    selectUserType: { id: 'auth/field/select-user-type', defaultMessage: 'Select a user type' },
    identifierLabel: { id: 'auth/field/identifier', defaultMessage: 'Sign-in name' },
    anchorLabel: { id: 'auth/users/anchor', defaultMessage: 'Unit' },
    scopeLabel: { id: 'auth/users/scope', defaultMessage: 'Include the whole subtree' },
    searchPlaceholder: { id: 'auth/users/search', defaultMessage: 'Search' },
    allowedOrgTypesLegend: {
      id: 'auth/field/allowed-org-types',
      defaultMessage: 'May be placed on these kinds of organization node',
    },
    placementUnrestricted: {
      id: 'auth/field/placement-unrestricted',
      defaultMessage: 'May be placed anywhere',
    },
    placementTenantRoot: {
      id: 'auth/field/placement-tenant-root',
      defaultMessage: 'Fixed at the tenant root',
    },
    placementHint: {
      id: 'auth/field/placement-hint',
      defaultMessage:
        'Where this kind of person belongs. It says nothing about what they may do, which is what roles decide.',
    },
    placementCount: placementCountMessage,
    noOptions: { id: 'auth/field/no-options', defaultMessage: 'Nothing to choose from yet.' },
    noAnchors: {
      id: 'auth/users/no-anchors',
      defaultMessage: 'You do not administer users anywhere yet.',
    },

    create: { id: 'auth/action/create', defaultMessage: 'Create' },
    save: { id: 'auth/action/save', defaultMessage: 'Save' },
    cancel: { id: 'auth/action/cancel', defaultMessage: 'Cancel' },
    delete: { id: 'auth/action/delete', defaultMessage: 'Delete' },
    enable: { id: 'auth/action/enable', defaultMessage: 'Enable' },
    disable: { id: 'auth/action/disable', defaultMessage: 'Disable' },
    loadMore: { id: 'auth/action/load-more', defaultMessage: 'Load more' },
    treeSearch: { id: 'auth/users/tree-search', defaultMessage: 'Search units' },
    pickSomeone: {
      id: 'auth/users/pick-someone',
      defaultMessage: 'Pick a row to see who they are.',
    },
    fullProfile: { id: 'auth/users/full-profile', defaultMessage: 'Full profile' },
    accountsLabel: { id: 'auth/users/accounts', defaultMessage: 'Sign-in accounts' },
    accountNone: { id: 'auth/users/account-none', defaultMessage: 'None bound' },
    accountCount: accountCountMessage,
    columnAccounts: { id: 'auth/users/column-accounts', defaultMessage: 'Accounts' },
    moveLabel: { id: 'auth/users/move', defaultMessage: 'Move' },
    movePick: { id: 'auth/users/move-pick', defaultMessage: 'Pick a unit' },
    moveAction: { id: 'auth/users/move-action', defaultMessage: 'Move here' },
    editProfile: { id: 'auth/person/edit-profile', defaultMessage: 'Edit profile' },
    profileTabIdentities: { id: 'auth/person/tab-identities', defaultMessage: 'Ways in' },
    profileTabRoles: { id: 'auth/person/tab-roles', defaultMessage: 'Roles' },
    boundHeading: { id: 'auth/person/bound', defaultMessage: 'Bound' },
    boundEmptyTitle: { id: 'auth/person/bound-empty', defaultMessage: 'No way in yet' },
    boundEmptyBody: {
      id: 'auth/person/bound-empty-body',
      defaultMessage: 'Until an entrance is bound, nobody can sign in as them.',
    },
    boundCount: boundCountMessage,
    lastUsed: lastUsedMessage,
    neverUsed: { id: 'auth/person/never-used', defaultMessage: 'Never used' },
    localAccount: { id: 'auth/person/local-account', defaultMessage: 'Password' },
    federatedAccount: { id: 'auth/person/federated-account', defaultMessage: 'Federated' },
    entranceDisabled: { id: 'auth/person/entrance-disabled', defaultMessage: 'Entrance disabled' },
    manageWaysIn: { id: 'auth/person/manage-ways-in', defaultMessage: 'Manage entrances' },
    manageRoles: { id: 'auth/person/manage-roles', defaultMessage: 'Manage roles' },
    pickSomeoneTitle: { id: 'auth/users/pick-title', defaultMessage: 'Open somebody' },
    pickUnitTitle: { id: 'auth/users/pick-unit-title', defaultMessage: 'Choose a unit' },
    pickUnitBody: {
      id: 'auth/users/pick-unit-body',
      defaultMessage: 'The roster of whichever unit is open appears here.',
    },
    pickTypeTitle: { id: 'auth/user-types/pick-title', defaultMessage: 'Open a user type' },
    pickTypeBody: {
      id: 'auth/user-types/pick-body',
      defaultMessage: 'Where a kind of person may belong is set here.',
    },
    pickProviderTitle: { id: 'auth/login-methods/pick-title', defaultMessage: 'Open an entrance' },
    pickProviderBody: {
      id: 'auth/login-methods/pick-body',
      defaultMessage: 'Who may sign in through an entrance is set here.',
    },
    rolesLabel: { id: 'auth/users/roles', defaultMessage: 'Roles' },
    rolesNone: { id: 'auth/users/roles-none', defaultMessage: 'None' },
    treeSearchEmpty: {
      id: 'auth/users/tree-search-empty',
      defaultMessage: 'No unit matches the search.',
    },
    scopeSelf: { id: 'auth/users/scope-self', defaultMessage: 'This unit' },
    scopeSubtree: { id: 'auth/users/scope-subtree', defaultMessage: 'With children' },
    typeFilterAll: { id: 'auth/users/type-filter-all', defaultMessage: 'All types' },
    typeFilterLabel: { id: 'auth/users/type-filter', defaultMessage: 'User type' },
    columnName: { id: 'auth/users/column-name', defaultMessage: 'Name' },
    columnBusinessNo: { id: 'auth/users/column-business-no', defaultMessage: 'ID number' },
    columnType: { id: 'auth/users/column-type', defaultMessage: 'Type' },
    columnUnit: { id: 'auth/users/column-unit', defaultMessage: 'Unit' },
    columnStatus: { id: 'auth/users/column-status', defaultMessage: 'Status' },
    statusActive: { id: 'auth/users/status-active', defaultMessage: 'Active' },
    loadedCount: {
      id: 'auth/users/loaded-count',
      defaultMessage: '{count, plural, one {# person listed} other {# people listed}}',
    },
    transfer: { id: 'auth/action/transfer', defaultMessage: 'Transfer' },
    saved: { id: 'auth/feedback/saved', defaultMessage: 'Saved.' },
    systemBadge: { id: 'auth/badge/system', defaultMessage: 'system' },
    disabledBadge: { id: 'auth/badge/disabled', defaultMessage: 'disabled' },
    deletedBadge: { id: 'auth/badge/deleted', defaultMessage: 'deleted' },
    deleteAction: { id: 'auth/action/delete-user', defaultMessage: 'Delete' },
    restoreAction: { id: 'auth/action/restore-user', defaultMessage: 'Restore' },
    confirmUserDeleteTitle: {
      id: 'auth/confirm/user-delete-title',
      defaultMessage: 'Delete this user?',
    },
    confirmUserDeleteBody: {
      id: 'auth/confirm/user-delete-body',
      defaultMessage:
        'Their roles and sign-in accounts are withdrawn. The person can be restored later, their access cannot.',
    },
    viewLabel: { id: 'auth/users/view', defaultMessage: 'Which people' },
    viewLiving: { id: 'auth/users/view-living', defaultMessage: 'Current' },
    viewDeleted: { id: 'auth/users/view-deleted', defaultMessage: 'Deleted' },
    confirmDeleteTitle: { id: 'auth/confirm/delete-title', defaultMessage: 'Delete permanently?' },
    confirmDeleteBody: { id: 'auth/confirm/delete-body', defaultMessage: 'This cannot be undone.' },
    confirmDisableTitle: { id: 'auth/confirm/disable-title', defaultMessage: 'Disable this user?' },
    confirmDisableBody: {
      id: 'auth/confirm/disable-body',
      defaultMessage: 'Their sessions end immediately.',
    },
    systemTypeHint: {
      id: 'auth/user-types/system-hint',
      defaultMessage: 'A system user type cannot be deleted; its policy stays editable.',
    },
    rename: { id: 'auth/action/rename', defaultMessage: 'Rename' },
    statusDisabled: { id: 'auth/state/disabled', defaultMessage: 'Disabled' },
    discard: { id: 'auth/action/discard', defaultMessage: 'Discard' },
    unsaved: { id: 'auth/state/unsaved', defaultMessage: 'Unsaved changes' },
    placementLegend: { id: 'auth/user-types/placement-legend', defaultMessage: 'May belong to' },
    placementAnywhere: { id: 'auth/user-types/placement-anywhere', defaultMessage: 'Anywhere' },
    placementListed: {
      id: 'auth/user-types/placement-listed',
      defaultMessage: 'Only these kinds',
    },
    signInLabel: { id: 'auth/user-types/sign-in', defaultMessage: 'Ways in' },
    signInNone: {
      id: 'auth/user-types/sign-in-none',
      defaultMessage: 'No entrance admits this type yet, so nobody holding it can sign in.',
    },
    signInSettings: { id: 'auth/user-types/sign-in-settings', defaultMessage: 'Set up' },
    openRolesLabel: { id: 'auth/user-types/open-roles', defaultMessage: 'Roles open to it' },
    openRolesNone: {
      id: 'auth/user-types/open-roles-none',
      defaultMessage: 'No role admits this type yet.',
    },
    lifecycleLabel: { id: 'auth/user-types/lifecycle', defaultMessage: 'Disable and delete' },
    blockerInUse: inUseBlockerMessage,
    blockerSystem: {
      id: 'auth/user-types/blocker-system',
      defaultMessage: 'A preset type stays for as long as the platform provisions it.',
    },
    blockerClear: {
      id: 'auth/user-types/blocker-clear',
      defaultMessage: 'Nothing holds this type back.',
    },
    loginMethodsTitle: { id: 'auth/login-methods/title', defaultMessage: 'Ways in' },
    loginMethodsHint: {
      id: 'auth/login-methods/hint',
      defaultMessage: 'Each entrance says which user types may sign in through it.',
    },
    loginMethodsEmpty: {
      id: 'auth/login-methods/empty',
      defaultMessage: 'No entrance is configured yet.',
    },
    loginMethodSelectHint: {
      id: 'auth/login-methods/select-hint',
      defaultMessage: 'Open an entrance to say who may sign in through it.',
    },
    audienceLegend: { id: 'auth/login-methods/audience', defaultMessage: 'May sign in' },
    audienceAnyone: { id: 'auth/login-methods/audience-anyone', defaultMessage: 'Anyone' },
    audienceListed: {
      id: 'auth/login-methods/audience-listed',
      defaultMessage: 'Only these types',
    },
    audienceNobody: {
      id: 'auth/login-methods/audience-nobody',
      defaultMessage: 'Nobody can sign in through it while the list is empty.',
    },
    providerKindLabel: { id: 'auth/login-methods/kind', defaultMessage: 'Kind' },
    providerCodeLabel: { id: 'auth/login-methods/code', defaultMessage: 'Address' },
    providerCodeHint: {
      id: 'auth/login-methods/code-hint',
      defaultMessage: 'Fixed once created.',
    },
    providerOrderLabel: { id: 'auth/login-methods/order', defaultMessage: 'Sign-in page order' },
    audienceSummary: audienceSummaryMessage,
    audienceEveryone: {
      id: 'auth/login-methods/audience-everyone',
      defaultMessage: 'Open to every user type',
    },
    userCount: userCountMessage,
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof authErrors>>()({
    USER_TYPE_NOT_FOUND: {
      id: 'auth/error/user-type-not-found',
      defaultMessage: 'User type not found.',
    },
    USER_TYPE_CONFLICT: {
      id: 'auth/error/user-type-conflict',
      defaultMessage: 'A user type with that code or name already exists.',
    },
    USER_TYPE_IS_SYSTEM: {
      id: 'auth/error/user-type-is-system',
      defaultMessage: 'System user types cannot be changed this way.',
    },
    USER_TYPE_IN_USE: {
      message: userTypeInUseMessage,
      values: (data) => ({ userCount: data.userCount }),
    },
    USER_TYPE_LAST_FOR_ROLE: {
      message: userTypeLastForRoleMessage,
      values: (data) => ({ roleCount: data.roleCount }),
    },
    RECOVERY_CHANNEL_REQUIRED: {
      id: 'auth/error/recovery-channel-required',
      defaultMessage: 'The administrator user type must keep password sign-in.',
    },
    USER_TYPE_PLACEMENT_NOT_ALLOWED: {
      id: 'auth/error/user-type-placement-not-allowed',
      defaultMessage: 'That kind of person may not be placed on this kind of node.',
    },
    USER_TYPE_PLACEMENT_IN_USE: {
      message: placementInUseMessage,
      values: (data) => ({ userCount: data.userCount }),
    },
    USER_TYPE_VERSION_CONFLICT: {
      id: 'auth/error/user-type-version-conflict',
      defaultMessage: 'The user type changed since you opened it. Reload and try again.',
    },
    AUTH_PROVIDER_NOT_FOUND: {
      id: 'auth/error/provider-not-found',
      defaultMessage: 'This login method no longer exists.',
    },
    AUTH_PROVIDER_VERSION_CONFLICT: {
      id: 'auth/error/provider-version-conflict',
      defaultMessage: 'The login method changed since you opened it. Reload and try again.',
    },
    USER_TYPE_ORG_TYPE_NOT_FOUND: {
      id: 'auth/error/user-type-org-type-not-found',
      defaultMessage: 'Organization type not found.',
    },
    USER_TYPE_DISABLED: {
      id: 'auth/error/user-type-disabled',
      defaultMessage: 'That user type is disabled.',
    },
    USER_NOT_FOUND: { id: 'auth/error/user-not-found', defaultMessage: 'User not found.' },
    USER_CONFLICT: {
      id: 'auth/error/user-conflict',
      defaultMessage: 'That business number is already taken.',
    },
    USER_PLACEMENT_NOT_FOUND: {
      id: 'auth/error/user-placement-not-found',
      defaultMessage: 'That organization node does not exist in this tenant.',
    },
    GRANT_INCOMPATIBLE: {
      message: grantIncompatibleMessage,
      values: (data) => ({ grantCount: data.grantCount }),
    },
    SYSTEM_ACCOUNT_PROTECTED: {
      id: 'auth/error/system-account-protected',
      defaultMessage:
        'The system account is how this tenant recovers itself, so its type, status and placement are fixed.',
    },
    USER_VERSION_CONFLICT: {
      id: 'auth/error/user-version-conflict',
      defaultMessage: 'This person changed while the page was open. Reload and try again.',
    },
    USER_NOT_DISABLED: {
      id: 'auth/error/user-not-disabled',
      defaultMessage: 'Disable the account first, then delete it.',
    },
    USER_DELETED: {
      id: 'auth/error/user-deleted',
      defaultMessage: 'This person is deleted. Restore them first.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const authMessages = i18n.messages
export const iamMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
