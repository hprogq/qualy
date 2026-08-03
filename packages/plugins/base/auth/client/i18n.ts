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
const userTypeLastForRoleMessage = defineMessage<{ roleCount: number }>()({
  id: 'auth/error/user-type-last-for-role',
  defaultMessage:
    '{roleCount, plural, one {# role allows} other {# roles allow}} this user type and no other.',
})
const permissionNotGrantableMessage = defineMessage<{ count: number }>()({
  id: 'auth/error/permission-not-grantable',
  defaultMessage:
    '{count, plural, one {# permission cannot} other {# permissions cannot}} be granted this way.',
})
const assignmentIncompatibleMessage = defineMessage<{ assignmentCount: number }>()({
  id: 'auth/error/assignment-incompatible',
  defaultMessage:
    '{assignmentCount, plural, one {# role grant does} other {# role grants do}} not allow this change.',
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
    usersHint: {
      id: 'auth/users/hint',
      defaultMessage: 'Users are administered where they stand in the organization.',
    },
    usersEmpty: { id: 'auth/users/empty', defaultMessage: 'No users here yet.' },
    userTypesTitle: { id: 'auth/user-types/title', defaultMessage: 'User types' },
    userTypesHint: {
      id: 'auth/user-types/hint',
      defaultMessage:
        'A user type decides how a class of people signs in and what they may do tenant-wide.',
    },
    userTypesEmpty: { id: 'auth/user-types/empty', defaultMessage: 'No user types yet.' },
    userDetailTitle: { id: 'auth/users/detail-title', defaultMessage: 'User' },
    backToUsers: { id: 'auth/users/back', defaultMessage: '← All users' },
    profileSection: { id: 'auth/users/profile', defaultMessage: 'Profile' },
    placementSection: { id: 'auth/users/placement', defaultMessage: 'Organization placement' },
    grantsSection: { id: 'auth/users/grants', defaultMessage: 'Role grants' },
    grantsEmpty: { id: 'auth/users/grants-empty', defaultMessage: 'No role grants.' },
    grantsHint: {
      id: 'auth/users/grants-hint',
      defaultMessage: 'Only grants anchored where you administer are shown and editable.',
    },
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
    anchorLabel: { id: 'auth/users/anchor', defaultMessage: 'Organization node' },
    scopeLabel: { id: 'auth/users/scope', defaultMessage: 'Include the whole subtree' },
    searchPlaceholder: { id: 'auth/users/search', defaultMessage: 'Search' },
    loginChannels: { id: 'auth/field/login-channels', defaultMessage: 'Sign-in channels' },
    allowLocalLogin: { id: 'auth/field/allow-local-login', defaultMessage: 'Password sign-in' },
    allowSsoLogin: { id: 'auth/field/allow-sso-login', defaultMessage: 'Single sign-on' },
    permissionsLegend: { id: 'auth/field/permissions', defaultMessage: 'Tenant permissions' },
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
    transfer: { id: 'auth/action/transfer', defaultMessage: 'Transfer' },
    saved: { id: 'auth/feedback/saved', defaultMessage: 'Saved.' },
    systemBadge: { id: 'auth/badge/system', defaultMessage: 'system' },
    disabledBadge: { id: 'auth/badge/disabled', defaultMessage: 'disabled' },
    noLoginBadge: { id: 'auth/badge/no-login', defaultMessage: 'cannot sign in' },
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
    userCount: userCountMessage,
  },
  errors: defineErrorTranslations(iamErrors, {
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
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const authMessages = i18n.messages
export const iamMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
