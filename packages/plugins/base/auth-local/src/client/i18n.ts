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
    wait: { id: 'auth-local/action/wait', defaultMessage: 'Try again in {time}' },
    forgot: { id: 'auth-local/action/forgot', defaultMessage: 'Forgot password?' },
    showPassword: { id: 'auth-local/action/show-password', defaultMessage: 'Show password' },
    hidePassword: { id: 'auth-local/action/hide-password', defaultMessage: 'Hide password' },
    remember: { id: 'auth-local/field/remember', defaultMessage: 'Remember my email on this device' },
    emailInvalid: { id: 'auth-local/check/email', defaultMessage: 'Enter a valid email address' },
    passwordShort: {
      id: 'auth-local/check/password-short',
      defaultMessage: 'A password here has at least {min, plural, other {# characters}}',
    },
    passwordLong: {
      id: 'auth-local/check/password-long',
      defaultMessage: 'A password here has at most {max, plural, other {# characters}}',
    },
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
