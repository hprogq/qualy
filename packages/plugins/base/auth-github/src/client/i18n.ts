import {
  defineErrorTranslations,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as authGithubErrors from '../api.ts'

// The words a GitHub entrance is set up in, and what the sign-in page or the
// account page says when a trip to GitHub comes back without one.

const i18n = definePluginMessages({
  namespace: 'auth-github',
  messages: {
    kind: { id: 'auth-github/entrance/kind', defaultMessage: 'GitHub' },
    clientId: { id: 'auth-github/field/client-id', defaultMessage: 'Client ID' },
    clientSecret: { id: 'auth-github/field/client-secret', defaultMessage: 'Client secret' },
    enterpriseUrl: {
      id: 'auth-github/field/enterprise-url',
      defaultMessage: 'GitHub Enterprise Server address',
    },
    enterpriseUrlHint: {
      id: 'auth-github/field/enterprise-url-hint',
      defaultMessage: 'Leave empty for github.com',
    },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof authGithubErrors>>()({
    AUTH_GITHUB_REJECTED: {
      id: 'auth-github/error/rejected',
      defaultMessage: 'GitHub did not confirm your account. Try again.',
    },
    AUTH_GITHUB_UNAVAILABLE: {
      id: 'auth-github/error/unavailable',
      defaultMessage: 'GitHub cannot be reached right now. Try again later.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const githubMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
