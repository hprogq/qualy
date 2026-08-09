import { definePluginMessages } from '@qualy/i18n-contract'

// The shell's own words. Section names are not among them: groups are
// registered by plugins through the navigation-groups collection and arrive
// with their labels; the shell only says what its own chrome does.

const i18n = definePluginMessages({
  namespace: 'layout',
  messages: {
    toggleSidebar: {
      id: 'layout/shell/toggle-sidebar',
      defaultMessage: 'Toggle sidebar',
    },
    language: {
      id: 'layout/shell/language',
      defaultMessage: 'Interface language',
    },
  },
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const layoutMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
