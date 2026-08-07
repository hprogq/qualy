import { definePluginMessages } from '@qualy/i18n-contract'
import { pingNavigationLabel } from '../ui.ts'

const i18n = definePluginMessages({
  namespace: 'ping',
  messages: { navigation: pingNavigationLabel },
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const catalogs = i18n.catalogs
