import {
  defineErrorTranslations,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as contract from '../contract.ts'

// What the challenge host says: very little. A silent challenge is reported
// by the caller's own button; the host speaks only to a screen reader while
// it works, when something went wrong, and as the title of an interactive
// challenge shown over the page.

const i18n = definePluginMessages({
  namespace: 'captcha',
  messages: {
    working: { id: 'captcha/state/working', defaultMessage: 'Checking this request' },
    failed: {
      id: 'captcha/state/failed',
      defaultMessage: 'The security check could not finish',
    },
    retry: { id: 'captcha/action/retry', defaultMessage: 'Try again' },
    dialogTitle: { id: 'captcha/dialog/title', defaultMessage: 'Security check' },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof contract>>()({
    CAPTCHA_REQUIRED: {
      id: 'captcha/error/required',
      defaultMessage: 'Complete the security check to continue.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const captchaMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
