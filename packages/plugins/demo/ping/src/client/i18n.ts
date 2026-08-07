import { definePluginMessages } from '@qualy/i18n-contract'

const i18n = definePluginMessages({
  namespace: 'ping',
  messages: {},
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const catalogs = i18n.catalogs
