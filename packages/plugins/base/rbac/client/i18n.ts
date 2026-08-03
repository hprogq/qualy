import {
  defineErrorTranslations,
  defineMessage,
  definePluginMessages,
} from '@qualy/i18n-contract'
import { adminErrors } from '../src/administration.ts'
import { rbacNavigation } from '../src/messages.ts'

const assignmentCountMessage = defineMessage<{ count: number }>()({
  id: 'rbac/roles/assignment-count',
  defaultMessage: '{count, plural, one {# assignment} other {# assignments}}',
})
const roleInUseMessage = defineMessage<{ assignmentCount: number }>()({
  id: 'rbac/error/role-in-use',
  defaultMessage:
    '{assignmentCount, plural, one {# assignment still uses} other {# assignments still use}} this role.',
})
const permissionNotGrantableMessage = defineMessage<{ count: number }>()({
  id: 'rbac/error/role-permission-not-grantable',
  defaultMessage:
    '{count, plural, one {# permission cannot} other {# permissions cannot}} be granted to this role.',
})
const assignmentIncompatibleMessage = defineMessage<{ assignmentCount: number }>()({
  id: 'rbac/error/assignment-not-eligible',
  defaultMessage:
    '{assignmentCount, plural, one {# assignment would} other {# assignments would}} become invalid.',
})

const i18n = definePluginMessages({
  namespace: 'rbac',
  messages: {
    rolesNav: rbacNavigation.rolesNav,
    rolesTitle: { id: 'rbac/roles/title', defaultMessage: 'Roles' },
    newRole: { id: 'rbac/roles/new', defaultMessage: 'New organization role' },
    nameLabel: { id: 'rbac/field/name', defaultMessage: 'Name' },
    codeLabel: { id: 'rbac/field/code', defaultMessage: 'Code' },
    create: { id: 'rbac/action/create', defaultMessage: 'Create' },
    delete: { id: 'rbac/action/delete', defaultMessage: 'Delete' },
    enable: { id: 'rbac/action/enable', defaultMessage: 'Enable' },
    disable: { id: 'rbac/action/disable', defaultMessage: 'Disable' },
    systemBadge: { id: 'rbac/badge/system', defaultMessage: 'system' },
    tenantKind: { id: 'rbac/kind/tenant', defaultMessage: 'tenant-wide' },
    orgKind: { id: 'rbac/kind/org', defaultMessage: 'organization' },
    confirmDelete: { id: 'rbac/confirm/delete', defaultMessage: 'Delete this role?' },
    assignmentCount: assignmentCountMessage,
  },
  errors: defineErrorTranslations(adminErrors, {
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
      values: (data) => ({ assignmentCount: data.assignmentCount }),
    },
    ROLE_NEEDS_ALLOWED_SETS: {
      id: 'rbac/error/role-needs-allowed-sets',
      defaultMessage: 'An organization role needs at least one allowed user type and org type.',
    },
    ROLE_PERMISSION_NOT_GRANTABLE: {
      message: permissionNotGrantableMessage,
      values: (data) => ({ count: data.rejected.length }),
    },
    ASSIGNMENT_NOT_ELIGIBLE: {
      message: assignmentIncompatibleMessage,
      values: (data) => ({ assignmentCount: data.assignmentCount }),
    },
    ASSIGNMENT_NOT_FOUND: {
      id: 'rbac/error/assignment-not-found',
      defaultMessage: 'Assignment not found.',
    },
    ROLE_USER_TYPE_NOT_FOUND: {
      id: 'rbac/error/role-user-type-not-found',
      defaultMessage: 'User type not found.',
    },
    ROLE_ORG_TYPE_NOT_FOUND: {
      id: 'rbac/error/role-org-type-not-found',
      defaultMessage: 'Organization type not found.',
    },
    TENANT_ADMIN_REQUIRED: {
      id: 'rbac/error/tenant-admin-required',
      defaultMessage: 'Only a tenant administrator may grant or revoke that role.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const rbacMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
