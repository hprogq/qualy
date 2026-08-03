import {
  defineErrorTranslations,
  defineMessage,
  definePluginMessages,
  mergeErrorTranslations,
} from '@qualy/i18n-contract'
import { accessInvariantErrors } from '@qualy/rbac-contract'
import { accessErrors } from '../src/errors.ts'
import { rbacNavigation } from '../src/messages.ts'

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
const bindMessage = defineMessage<{ count: number }>()({
  id: 'rbac/error/grant-escalation-refused',
  defaultMessage: 'That role carries authority beyond your own, so you cannot grant it.',
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

const i18n = definePluginMessages({
  namespace: 'rbac',
  messages: {
    rolesNav: rbacNavigation.rolesNav,
    rolesTitle: { id: 'rbac/roles/title', defaultMessage: 'Roles' },
    rolesHint: {
      id: 'rbac/roles/hint',
      defaultMessage: 'Select a role to edit what it may hold and who may hold it.',
    },
    rolesEmpty: { id: 'rbac/roles/empty', defaultMessage: 'No roles yet.' },
    newRole: { id: 'rbac/roles/new', defaultMessage: 'New organization role' },
    newRoleHint: {
      id: 'rbac/roles/new-hint',
      defaultMessage:
        'A role is created complete: without permissions and eligibility it can be granted to nobody.',
    },
    editRole: { id: 'rbac/roles/edit', defaultMessage: 'Role configuration' },
    nameLabel: { id: 'rbac/field/name', defaultMessage: 'Name' },
    codeLabel: { id: 'rbac/field/code', defaultMessage: 'Code' },
    descriptionLabel: { id: 'rbac/field/description', defaultMessage: 'Description' },
    permissionsLegend: { id: 'rbac/field/permissions', defaultMessage: 'Permissions' },
    // named for the question each answers: a role is granted TO people and
    // applies AT places, and neither is the same as where those people
    // personally belong
    userTypesLegend: {
      id: 'rbac/field/allowed-user-types',
      defaultMessage: 'May be granted to these user types',
    },
    orgTypesLegend: {
      id: 'rbac/field/allowed-org-types',
      defaultMessage: 'This duty applies at these kinds of node',
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
    defineErrorTranslations(accessErrors, {
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
        message: bindMessage,
        values: (data) => ({ count: data.permissions.length }),
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
    defineErrorTranslations(accessInvariantErrors, {
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
