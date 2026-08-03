import type { PluginCatalogs } from '@qualy/i18n-contract'
import { pingNavigationLabel } from '../src/messages.ts'

export const catalogs: PluginCatalogs = {
  namespace: 'ping',
  messages: [pingNavigationLabel],
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
}
