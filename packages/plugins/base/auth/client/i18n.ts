import type { MessageDescriptor, PluginCatalogs } from '@qualy/i18n-contract'

// the auth plugin owns the auth/* message namespace
const define = <T extends Record<string, MessageDescriptor>>(messages: T) => messages

export const authMessages = define({
  title: { id: 'auth/login/title', defaultMessage: 'Sign in to Qualy' },
  methodsFailedTitle: {
    id: 'auth/login/methods-failed',
    defaultMessage: 'Could not load the sign-in methods',
  },
  methodsFailedHint: {
    id: 'auth/login/methods-failed-hint',
    defaultMessage: 'Check your connection and try again.',
  },
  noMethods: {
    id: 'auth/login/no-methods',
    defaultMessage: 'No sign-in method is available. Please contact an administrator.',
  },
  otherMethods: { id: 'auth/login/other-methods', defaultMessage: '← Other sign-in methods' },
  rendererMissing: {
    id: 'auth/login/renderer-missing',
    defaultMessage: 'This sign-in method is currently unavailable',
  },
  signIn: { id: 'auth/action/sign-in', defaultMessage: 'Sign in' },
  signOut: { id: 'auth/action/sign-out', defaultMessage: 'Sign out' },
})

export const catalogs: PluginCatalogs = {
  namespace: 'auth',
  messages: Object.values(authMessages),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
}
