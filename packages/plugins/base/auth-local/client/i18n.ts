import type { ErrorMessageMap, MessageDescriptor, PluginCatalogs } from '@qualy/i18n-contract'

const define = <T extends Record<string, MessageDescriptor>>(messages: T) => messages

export const localMessages = define({
  identifier: { id: 'auth-local/field/identifier', defaultMessage: 'Username' },
  password: { id: 'auth-local/field/password', defaultMessage: 'Password' },
  submit: { id: 'auth-local/action/submit', defaultMessage: 'Sign in' },
  submitting: { id: 'auth-local/action/submitting', defaultMessage: 'Signing in…' },
})

export const errorMessages: ErrorMessageMap = {
  INVALID_CREDENTIALS: {
    message: {
      id: 'auth-local/error/invalid-credentials',
      defaultMessage: 'Incorrect username or password.',
    },
  },
}

export const catalogs: PluginCatalogs = {
  namespace: 'auth-local',
  messages: [
    ...Object.values(localMessages),
    ...Object.values(errorMessages).map((entry) => entry.message),
  ],
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
}
