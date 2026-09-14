// compiled output: the declaration survives compilation, the source does not
import { definePluginMessages } from '@qualy/i18n-contract'

const i18n = definePluginMessages({
  namespace: 'acme-probe',
  messages: {
    title: { id: 'acme-probe/page/title', defaultMessage: 'Probe' },
    standing: { id: 'acme-probe/page/standing', defaultMessage: 'Ready' },
  },
  locales: {
    'zh-CN': () => import('./zh-CN.js'),
  },
})

export const messages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
