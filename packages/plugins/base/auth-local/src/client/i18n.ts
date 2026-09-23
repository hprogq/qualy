import {
  defineErrorTranslations,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as authLocalErrors from '../api.ts'

const i18n = definePluginMessages({
  namespace: 'auth-local',
  messages: {
    bindingPassword: { id: 'auth-local/binding/password', defaultMessage: 'Password' },
    entranceKind: { id: 'auth-local/entrance/kind', defaultMessage: 'Email and password' },
    email: { id: 'auth-local/field/email', defaultMessage: 'Email' },
    password: { id: 'auth-local/field/password', defaultMessage: 'Password' },
    submit: { id: 'auth-local/action/submit', defaultMessage: 'Sign in' },
    submitting: { id: 'auth-local/action/submitting', defaultMessage: 'Signing in…' },
    forgot: { id: 'auth-local/action/forgot', defaultMessage: 'Forgot password?' },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof authLocalErrors>>()({
    INVALID_CREDENTIALS: {
      id: 'auth-local/error/invalid-credentials',
      defaultMessage: 'Incorrect email or password.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const localMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
