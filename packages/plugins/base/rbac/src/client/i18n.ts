import {
  defineErrorTranslations,
  defineMessage,
  definePluginMessages,
  mergeErrorTranslations,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as rbacErrors from '../server/errors.ts'
import type * as invariantErrors from '@qualy/rbac-contract/effect'

const permissionCountMessage = defineMessage<{ count: number }>()({
  id: 'rbac/roles/permission-count',
  defaultMessage: '{count, plural, one {# permission} other {# permissions}}',
})

const assignmentCountMessage = defineMessage<{ count: number }>()({
  id: 'rbac/roles/assignment-count',
  defaultMessage: '{count, plural, one {# grant} other {# grants}}',
})
const roleInUseMessage = defineMessage<{ assignmentCount: number }>()({
  id: 'rbac/error/role-in-use',
  defaultMessage:
    '{assignmentCount, plural, one {# grant still uses} other {# grants still use}} this role.',
})
const incompleteMessage = defineMessage<{ missing: string }>()({
  id: 'rbac/error/role-incomplete',
  defaultMessage: 'The role still needs: {missing}.',
})
const targetMismatchMessage = defineMessage<{ count: number }>()({
  id: 'rbac/error/role-target-mismatch',
  defaultMessage:
    '{count, plural, one {# permission does} other {# permissions do}} not fit this kind of role.',
})
const unknownPermissionMessage = defineMessage<{ count: number }>()({
  id: 'rbac/error/permission-not-found',
  defaultMessage: '{count, plural, one {# permission is} other {# permissions are}} not available.',
})
const escalationMessage = defineMessage<{ count: number }>()({
  id: 'rbac/error/role-escalation-refused',
  defaultMessage:
    'A role cannot be given {count, plural, one {# permission} other {# permissions}} you do not hold yourself.',
})
const selfEscalationMessage = defineMessage<{ count: number }>()({
  id: 'rbac/error/grant-escalation-refused',
  defaultMessage: 'Granting yourself that role would add authority you do not hold.',
})
const confirmPermissionsBody = defineMessage<{ holders: number; appointers: number }>()({
  id: 'rbac/roles/confirm-permissions-body',
  defaultMessage:
    'This takes effect immediately for {holders, plural, =0 {no current holders} one {1 current holder} other {# current holders}}, and {appointers, plural, =0 {no role} one {1 role} other {# roles}} appointing this one will hand out the new duties from now on.',
})
const appointmentMessage = defineMessage<{ reason: string }>()({
  id: 'rbac/error/role-appointment-invalid',
  defaultMessage:
    '{reason, select, self {A role cannot appoint itself.} cycle {That would make the appointment relations circular.} kind {A role may only appoint roles of its own kind.} other {The role needs grant administration before it can appoint anybody.}}',
})
const strandedMessage = defineMessage<{ assignmentCount: number }>()({
  id: 'rbac/error/grant-stranded',
  defaultMessage:
    '{assignmentCount, plural, one {# existing grant would} other {# existing grants would}} no longer qualify.',
})
// the refusal says which rule was broken, so the screen can point at the
// thing an administrator actually has to change
const notEligibleMessage = defineMessage<{ reason: string }>()({
  id: 'rbac/error/grant-not-eligible',
  defaultMessage:
    '{reason, select, role-unassignable {That role cannot be granted right now.} user-disabled {A disabled user cannot be granted a role.} user-type {That role is not available to this user type.} org-type {That role cannot be anchored at this kind of node.} tenant-role-anchored {A tenant-wide role can only be granted across the whole organization.} org-role-unanchored {An organization role must be granted at a node.} other {That grant is not allowed.}}',
})

const pickedMessage = defineMessage<{ picked: number; total: number }>()({
  id: 'rbac/roles/picked-of',
  defaultMessage: '{picked}/{total}',
})
const memberLineMessage = defineMessage<{ holders: number; appointers: number }>()({
  id: 'rbac/roles/member-line',
  defaultMessage:
    '{holders, plural, =0 {nobody holds it} one {1 holder} other {# holders}} · appointed by {appointers, plural, =0 {no role} one {1 role} other {# roles}}',
})

const i18n = definePluginMessages({
  namespace: 'rbac',
  messages: {
    // one label per permission this plugin declares. The definition
    // carries a message reference, so the role editor renders whatever
    // language its reader asked for rather than the one it was authored in.
    'permission.iam.role.read': {
      id: 'rbac/permission/role-read',
      defaultMessage: 'View roles',
    },
    'permission.iam.role.manage': {
      id: 'rbac/permission/role-manage',
      defaultMessage: 'Manage roles',
    },
    'permission.iam.role.escalate': {
      id: 'rbac/permission/role-escalate',
      defaultMessage: 'Define roles beyond your own authority',
    },
    'permission-hint.iam.role.escalate': {
      id: 'rbac/permission-hint/role-escalate',
      defaultMessage: 'Put a permission into a role without holding it yourself.',
    },
    'permission.iam.grant.read': {
      id: 'rbac/permission/grant-read',
      defaultMessage: 'View role assignments in the organization',
    },
    'permission.iam.grant.manage': {
      id: 'rbac/permission/grant-manage',
      defaultMessage: 'Manage role assignments in the organization',
    },
    'permission.iam.tenant-grant.read': {
      id: 'rbac/permission/tenant-grant-read',
      defaultMessage: 'View tenant-wide role assignments',
    },
    'permission.iam.tenant-grant.manage': {
      id: 'rbac/permission/tenant-grant-manage',
      defaultMessage: 'Manage tenant-wide role assignments',
    },
    'permission.iam.role.appointment.manage': {
      id: 'rbac/permission/role-appointment-manage',
      defaultMessage: 'Manage which roles appoint which',
    },
    'permission-hint.iam.role.appointment.manage': {
      id: 'rbac/permission-hint/role-appointment-manage',
      defaultMessage: 'Configure the roles that each role is allowed to appoint.',
    },
    'permission.iam.authorization.inspect': {
      id: 'rbac/permission/authorization-inspect',
      defaultMessage: 'Inspect where authority comes from',
    },
    rolesTitle: { id: 'rbac/roles/title', defaultMessage: 'Roles' },
    rolesHint: {
      id: 'rbac/roles/hint',
      defaultMessage: 'Maintain permissions, who may hold a role, and which roles it appoints.',
    },
    rolesEmpty: { id: 'rbac/roles/empty', defaultMessage: 'No roles yet.' },
    pickRoleTitle: { id: 'rbac/roles/pick-title', defaultMessage: 'Open a role' },
    pickRoleBody: {
      id: 'rbac/roles/pick-body',
      defaultMessage: 'What a role may do and who may hold it are set here.',
    },
    permissionCount: permissionCountMessage,
    roleSelectHint: {
      id: 'rbac/roles/select-hint',
      defaultMessage: 'Open a role to set its permissions and its grant rules.',
    },
    tenantGroup: { id: 'rbac/roles/tenant-group', defaultMessage: 'Tenant-wide' },
    tenantGroupHint: {
      id: 'rbac/roles/tenant-group-hint',
      defaultMessage: 'in effect across the whole tenant',
    },
    orgGroup: { id: 'rbac/roles/org-group', defaultMessage: 'Per unit' },
    orgGroupHint: {
      id: 'rbac/roles/org-group-hint',
      defaultMessage: 'granted at a unit',
    },
    newRole: { id: 'rbac/roles/new', defaultMessage: 'New organization role' },
    newRoleHint: {
      id: 'rbac/roles/new-hint',
      defaultMessage:
        'A role starts as a draft. Give it permissions and say who may hold it, then activate it.',
    },
    editRole: { id: 'rbac/roles/edit', defaultMessage: 'Role configuration' },
    rename: { id: 'rbac/action/rename', defaultMessage: 'Rename' },
    discard: { id: 'rbac/action/discard', defaultMessage: 'Discard' },
    selectAll: { id: 'rbac/action/select-all', defaultMessage: 'All' },
    unsaved: { id: 'rbac/state/unsaved', defaultMessage: 'Unsaved changes' },
    tabPermissions: { id: 'rbac/roles/tab-permissions', defaultMessage: 'Permissions' },
    tabEligibility: { id: 'rbac/roles/tab-eligibility', defaultMessage: 'Who may hold it' },
    tabAppointment: { id: 'rbac/roles/tab-appointment', defaultMessage: 'Appoints' },
    tabLifecycle: { id: 'rbac/roles/tab-lifecycle', defaultMessage: 'Status' },
    searchPermissions: {
      id: 'rbac/roles/search-permissions',
      defaultMessage: 'Search permissions',
    },
    searchEmpty: { id: 'rbac/roles/search-empty', defaultMessage: 'No permission matches.' },
    pickedOf: pickedMessage,
    memberLine: memberLineMessage,
    savePermissions: { id: 'rbac/roles/save-permissions', defaultMessage: 'Save permissions' },
    factKind: { id: 'rbac/roles/fact-kind', defaultMessage: 'Applies' },
    factStatus: { id: 'rbac/roles/fact-status', defaultMessage: 'Status' },
    factHolders: { id: 'rbac/roles/fact-holders', defaultMessage: 'Held by' },
    factEligibility: { id: 'rbac/roles/fact-eligibility', defaultMessage: 'Open to' },
    anyoneWord: { id: 'rbac/roles/anyone', defaultMessage: 'any user type' },
    anywhereWord: { id: 'rbac/roles/anywhere', defaultMessage: 'any kind of unit' },
    nobodyWord: { id: 'rbac/roles/nobody', defaultMessage: 'nobody yet' },
    everyPermission: {
      id: 'rbac/roles/every-permission',
      defaultMessage: 'Carries whatever this deployment serves, so there is nothing to tick.',
    },
    assignableLegend: { id: 'rbac/roles/assignable-legend', defaultMessage: 'Available to grant' },
    assignableOn: { id: 'rbac/roles/assignable-on', defaultMessage: 'Yes' },
    assignableOff: { id: 'rbac/roles/assignable-off', defaultMessage: 'No' },
    statusLegend: { id: 'rbac/roles/status-legend', defaultMessage: 'Status' },
    eligibilityAnyone: { id: 'rbac/roles/eligibility-anyone', defaultMessage: 'Anyone' },
    eligibilityListed: { id: 'rbac/roles/eligibility-listed', defaultMessage: 'Only these types' },
    anchorAnywhere: { id: 'rbac/roles/anchor-anywhere', defaultMessage: 'Any kind of unit' },
    anchorListed: { id: 'rbac/roles/anchor-listed', defaultMessage: 'Only these kinds' },
    groupOther: { id: 'rbac/roles/group-other', defaultMessage: 'Other' },
    nameLabel: { id: 'rbac/field/name', defaultMessage: 'Name' },
    codeLabel: { id: 'rbac/field/code', defaultMessage: 'Code' },
    descriptionLabel: { id: 'rbac/field/description', defaultMessage: 'Description' },
    permissionsLegend: { id: 'rbac/field/permissions', defaultMessage: 'Permissions' },
    grantableLegend: {
      id: 'rbac/roles/grantable-legend',
      defaultMessage: 'Roles this one may appoint',
    },
    grantableHint: {
      id: 'rbac/roles/grantable-hint',
      defaultMessage:
        'Appointment authority in force: holders appoint exactly these offices, within where they administer grants.',
    },
    grantableNeedsManage: {
      id: 'rbac/roles/grantable-needs-manage',
      defaultMessage:
        'Give this role grant administration first; only then can it appoint anybody.',
    },
    confirmPermissionsTitle: {
      id: 'rbac/roles/confirm-permissions-title',
      defaultMessage: 'Change what this role does?',
    },
    confirmPermissionsBody,
    // chosen at creation because it cannot be changed afterwards: it decides
    // whether the duty is anchored, and with it what the role may hold
    kindLegend: { id: 'rbac/field/kind', defaultMessage: 'Where this role applies' },
    kindOrg: { id: 'rbac/field/kind-org', defaultMessage: 'At an organization node' },
    kindOrgHint: {
      id: 'rbac/field/kind-org-hint',
      defaultMessage: 'Granted at a unit, and applies there or across its subtree.',
    },
    kindTenant: { id: 'rbac/field/kind-tenant', defaultMessage: 'Across the whole tenant' },
    kindTenantHint: {
      id: 'rbac/field/kind-tenant-hint',
      defaultMessage: 'Granted once, in force across the whole tenant.',
    },
    // named for the question each answers: a role is granted TO people and
    // applies AT places, and neither is the same as where those people
    // personally belong
    userTypesLegend: {
      id: 'rbac/field/allowed-user-types',
      defaultMessage: 'User types that may hold it',
    },
    orgTypesLegend: {
      id: 'rbac/field/allowed-org-types',
      defaultMessage: 'Kinds of unit where the duty applies',
    },
    anyUserType: {
      id: 'rbac/field/any-user-type',
      defaultMessage: 'May be granted to any user type',
    },
    anyOrgType: {
      id: 'rbac/field/any-org-type',
      defaultMessage: 'This duty applies at any kind of node',
    },
    noOptions: { id: 'rbac/field/no-options', defaultMessage: 'Nothing to choose from yet.' },
    assignableLabel: { id: 'rbac/field/assignable', defaultMessage: 'Can be granted' },
    create: { id: 'rbac/action/create', defaultMessage: 'Create' },
    save: { id: 'rbac/action/save', defaultMessage: 'Save' },
    cancel: { id: 'rbac/action/cancel', defaultMessage: 'Cancel' },
    delete: { id: 'rbac/action/delete', defaultMessage: 'Delete' },
    enable: { id: 'rbac/action/enable', defaultMessage: 'Enable' },
    disable: { id: 'rbac/action/disable', defaultMessage: 'Disable' },
    edit: { id: 'rbac/action/edit', defaultMessage: 'Edit' },
    saved: { id: 'rbac/feedback/saved', defaultMessage: 'Saved.' },
    systemBadge: { id: 'rbac/badge/system', defaultMessage: 'system' },
    disabledBadge: { id: 'rbac/badge/disabled', defaultMessage: 'disabled' },
    unassignableBadge: { id: 'rbac/badge/unassignable', defaultMessage: 'cannot be granted' },
    draftBadge: { id: 'rbac/badge/draft', defaultMessage: 'draft' },
    tenantKind: { id: 'rbac/kind/tenant', defaultMessage: 'tenant-wide' },
    orgKind: { id: 'rbac/kind/org', defaultMessage: 'organization' },
    confirmDeleteTitle: { id: 'rbac/confirm/delete-title', defaultMessage: 'Delete this role?' },
    confirmDeleteBody: { id: 'rbac/confirm/delete-body', defaultMessage: 'This cannot be undone.' },
    systemRoleHint: {
      id: 'rbac/roles/system-hint',
      defaultMessage:
        'The tenant administrator role is fixed: it cannot be disabled, deleted or rewritten.',
    },
    assignmentCount: assignmentCountMessage,
  },
  errors: mergeErrorTranslations(
    defineErrorTranslations<ErrorsByCode<typeof rbacErrors>>()({
      ROLE_NOT_FOUND: { id: 'rbac/error/role-not-found', defaultMessage: 'Role not found.' },
      ROLE_CONFLICT: {
        id: 'rbac/error/role-conflict',
        defaultMessage: 'A role with that code or name already exists.',
      },
      ROLE_IS_SYSTEM: {
        id: 'rbac/error/role-is-system',
        defaultMessage: 'System roles cannot be changed this way.',
      },
      ROLE_IN_USE: {
        message: roleInUseMessage,
        values: (data) => ({ assignmentCount: data.grantCount }),
      },
      ROLE_NEEDS_ELIGIBILITY: {
        id: 'rbac/error/role-needs-eligibility',
        defaultMessage:
          'An active role needs at least one eligible user type, and an organization role a node type.',
      },
      ROLE_ANCHOR_MISMATCH: {
        id: 'rbac/error/role-anchor-mismatch',
        defaultMessage: 'Refresh and try again: the role was edited as the other kind of role.',
      },
      GRANT_STRANDED: {
        message: strandedMessage,
        values: (data) => ({ assignmentCount: data.grantCount }),
      },
      GRANT_NOT_ELIGIBLE: {
        message: notEligibleMessage,
        values: (data) => ({ reason: data.reason }),
      },
      GRANT_NOT_FOUND: { id: 'rbac/error/grant-not-found', defaultMessage: 'Grant not found.' },
      TENANT_ADMIN_REQUIRED: {
        id: 'rbac/error/tenant-admin-required',
        defaultMessage: 'Only a tenant administrator may grant or revoke that role.',
      },
      ACCESS_TARGET_REQUIRED: {
        id: 'rbac/error/access-target-required',
        defaultMessage: 'That permission is checked against an organization node.',
      },
      GRANT_EXISTS: { id: 'rbac/error/grant-exists', defaultMessage: 'That grant already exists.' },
      GRANT_RULE_REFUSED: {
        id: 'rbac/error/grant-rule-refused',
        defaultMessage: 'None of your roles may appoint people to this one.',
      },
      GRANT_USER_NOT_FOUND: {
        id: 'rbac/error/grant-user-not-found',
        defaultMessage: 'That user is not in this tenant.',
      },
      GRANT_NODE_NOT_FOUND: {
        id: 'rbac/error/grant-node-not-found',
        defaultMessage: 'That organization node is not in this tenant.',
      },
      ROLE_VERSION_CONFLICT: {
        id: 'rbac/error/role-version-conflict',
        defaultMessage: 'Someone else changed this role. Reload and try again.',
      },
      ROLE_NOT_DRAFT: {
        id: 'rbac/error/role-not-draft',
        defaultMessage: 'Only a draft role can be activated.',
      },
      ROLE_INCOMPLETE: {
        message: incompleteMessage,
        values: (data) => ({ missing: data.missing.join(', ') }),
      },
      ROLE_TARGET_MISMATCH: {
        message: targetMismatchMessage,
        values: (data) => ({ count: data.permissions.length }),
      },
      PERMISSION_NOT_FOUND: {
        message: unknownPermissionMessage,
        values: (data) => ({ count: data.permissions.length }),
      },
      ROLE_ESCALATION_REFUSED: {
        message: escalationMessage,
        values: (data) => ({ count: data.permissions.length }),
      },
      GRANT_ESCALATION_REFUSED: {
        message: selfEscalationMessage,
        values: (data) => ({ count: data.permissions.length }),
      },
      ROLE_APPOINTMENT_INVALID: {
        message: appointmentMessage,
        values: (data) => ({ reason: data.reason }),
      },
      ROLE_USER_TYPE_NOT_FOUND: {
        id: 'rbac/error/role-user-type-not-found',
        defaultMessage: 'User type not found.',
      },
      ROLE_ORG_TYPE_NOT_FOUND: {
        id: 'rbac/error/role-org-type-not-found',
        defaultMessage: 'Organization type not found.',
      },
    }),
    // the shared lockout invariant: auth raises it too, and one code carries
    // one translation, so the plugin that owns the rule owns the wording
    // ACCESS_DENIED comes out of the same contract but belongs to nobody in
    // particular: every plugin's authorization raises it, so the shell
    // translates it and this table declares only the invariant rbac owns
    defineErrorTranslations<Omit<ErrorsByCode<typeof invariantErrors>, 'ACCESS_DENIED'>>()({
      LAST_ADMINISTRATOR: {
        id: 'rbac/error/last-administrator',
        defaultMessage: 'The tenant would be left without an administrator who can still sign in.',
      },
    }),
  ),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const rbacMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
