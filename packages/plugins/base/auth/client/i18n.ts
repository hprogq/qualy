import { defineErrorTranslations, defineMessage, definePluginMessages } from '@qualy/i18n-contract'
import { iamErrors } from '../src/iam/errors.ts'
import { iamMessages as navLabels } from '../src/iam/messages.ts'

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
const permissionNotGrantableMessage = defineMessage<{ count: number }>()({
  id: 'auth/error/permission-not-grantable',
  defaultMessage:
    '{count, plural, one {# permission cannot} other {# permissions cannot}} be granted this way.',
})
const assignmentIncompatibleMessage = defineMessage<{ assignmentCount: number }>()({
  id: 'auth/error/assignment-incompatible',
  defaultMessage:
    '{assignmentCount, plural, one {# role assignment does} other {# role assignments do}} not allow this change.',
})

const i18n = definePluginMessages({
  namespace: 'auth',
  messages: {
    title: { id: 'auth/login/title', defaultMessage: 'Sign in to Qualy' },
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
    usersNav: navLabels.usersNav,
    userTypesNav: navLabels.userTypesNav,
    usersTitle: { id: 'auth/users/title', defaultMessage: 'Users' },
    usersEmpty: { id: 'auth/users/empty', defaultMessage: 'No users here yet.' },
    userTypesTitle: { id: 'auth/user-types/title', defaultMessage: 'User types' },
    newUser: { id: 'auth/users/new', defaultMessage: 'New user' },
    newUserHint: {
      id: 'auth/users/new-hint',
      defaultMessage: 'The user is placed on the selected organization node.',
    },
    newUserType: { id: 'auth/user-types/new', defaultMessage: 'New user type' },
    nameLabel: { id: 'auth/field/name', defaultMessage: 'Name' },
    codeLabel: { id: 'auth/field/code', defaultMessage: 'Code' },
    userTypeLabel: { id: 'auth/field/user-type', defaultMessage: 'User type' },
    selectUserType: { id: 'auth/field/select-user-type', defaultMessage: 'Select a user type' },
    anchorLabel: { id: 'auth/users/anchor', defaultMessage: 'Organization node' },
    searchPlaceholder: { id: 'auth/users/search', defaultMessage: 'Search' },
    create: { id: 'auth/action/create', defaultMessage: 'Create' },
    delete: { id: 'auth/action/delete', defaultMessage: 'Delete' },
    enable: { id: 'auth/action/enable', defaultMessage: 'Enable' },
    disable: { id: 'auth/action/disable', defaultMessage: 'Disable' },
    systemBadge: { id: 'auth/badge/system', defaultMessage: 'system' },
    disabledBadge: { id: 'auth/badge/disabled', defaultMessage: 'disabled' },
    confirmDelete: {
      id: 'auth/confirm/delete',
      defaultMessage: 'Delete this permanently?',
    },
    userCount: userCountMessage,
  },
  errors: defineErrorTranslations(iamErrors, {
    USER_TYPE_NOT_FOUND: { id: 'auth/error/user-type-not-found', defaultMessage: 'User type not found.' },
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
    USER_TYPE_DISABLED: {
      id: 'auth/error/user-type-disabled',
      defaultMessage: 'That user type is disabled.',
    },
    USER_NOT_FOUND: { id: 'auth/error/user-not-found', defaultMessage: 'User not found.' },
    USER_CONFLICT: {
      id: 'auth/error/user-conflict',
      defaultMessage: 'That business number is already taken.',
    },
    IDENTITY_CONFLICT: {
      id: 'auth/error/identity-conflict',
      defaultMessage: 'That sign-in name is already taken.',
    },
    USER_PLACEMENT_NOT_FOUND: {
      id: 'auth/error/user-placement-not-found',
      defaultMessage: 'That organization node does not exist in this tenant.',
    },
    PERMISSION_NOT_GRANTABLE: {
      message: permissionNotGrantableMessage,
      values: (data) => ({ count: data.rejected.length }),
    },
    ASSIGNMENT_INCOMPATIBLE: {
      message: assignmentIncompatibleMessage,
      values: (data) => ({ assignmentCount: data.assignmentCount }),
    },
    LAST_ADMINISTRATOR: {
      id: 'auth/error/last-administrator',
      defaultMessage: 'The last tenant administrator cannot be removed or disabled.',
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
