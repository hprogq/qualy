import {
  defineErrorTranslations,
  defineMessage,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as settingsErrors from '../server/errors.ts'

// Everything the settings plugin says to a human: the terminology screen's
// copy, the labels the server sends by reference (permission, navigation,
// audit action), and a translation for every error its contract can raise.

const defaultWord = defineMessage<{ value: string }>()({
  id: 'settings/terminology/default',
  defaultMessage: 'Default: {value}',
})

const i18n = definePluginMessages({
  namespace: 'settings',
  messages: {
    'permission.settings.terminology.manage': {
      id: 'settings/permission/terminology-manage',
      defaultMessage: 'Manage terminology',
    },
    permissionGroup: {
      id: 'settings/permission-group/settings',
      defaultMessage: 'System settings',
    },
    navGroup: { id: 'settings/nav-group/system', defaultMessage: 'System settings' },
    navigation: { id: 'settings/navigation/terminology', defaultMessage: 'Terminology' },
    auditTermUpdate: { id: 'settings/audit/term-update', defaultMessage: 'Change terminology' },
    title: { id: 'settings/terminology/title', defaultMessage: 'Terminology' },
    hint: {
      id: 'settings/terminology/hint',
      defaultMessage:
        'The words this tenant uses on its screens. A language left blank keeps the default',
    },
    empty: {
      id: 'settings/terminology/empty',
      defaultMessage: 'No term is open for customisation in this deployment',
    },
    loadFailed: {
      id: 'settings/terminology/load-failed',
      defaultMessage: 'Terminology could not be loaded',
    },
    loading: { id: 'settings/terminology/loading', defaultMessage: 'Loading terminology' },
    retry: { id: 'settings/terminology/retry', defaultMessage: 'Try again' },
    defaultWord,
    save: { id: 'settings/terminology/save', defaultMessage: 'Save' },
    reset: { id: 'settings/terminology/reset', defaultMessage: 'Restore default' },
    saved: { id: 'settings/terminology/saved', defaultMessage: 'Saved' },
    customised: { id: 'settings/terminology/customised', defaultMessage: 'Customised' },
    localeZhCN: { id: 'settings/terminology/locale-zh-cn', defaultMessage: 'Simplified Chinese' },
    localeEnUS: { id: 'settings/terminology/locale-en-us', defaultMessage: 'English' },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof settingsErrors>>()({
    SETTING_NOT_FOUND: {
      id: 'settings/error/not-found',
      defaultMessage: 'That setting does not exist.',
    },
    SETTING_VERSION_CONFLICT: {
      id: 'settings/error/version-conflict',
      defaultMessage: 'Somebody else changed this term just now. Reload and try again.',
    },
    SETTING_VALUE_INVALID: {
      id: 'settings/error/value-invalid',
      defaultMessage: 'That value is not allowed here.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const settingsMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
