import {
  defineErrorTranslations,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as authLocalErrors from '../api.ts'

const i18n = definePluginMessages({
  namespace: 'auth-local',
  messages: {
    identifier: { id: 'auth-local/field/identifier', defaultMessage: 'Username' },
    password: { id: 'auth-local/field/password', defaultMessage: 'Password' },
    submit: { id: 'auth-local/action/submit', defaultMessage: 'Sign in' },
    submitting: { id: 'auth-local/action/submitting', defaultMessage: 'Signing in…' },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof authLocalErrors>>()({
    INVALID_CREDENTIALS: {
      id: 'auth-local/error/invalid-credentials',
      defaultMessage: 'Incorrect username or password.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const localMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
