import {
  defineErrorTranslations,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as authOidcErrors from '../api.ts'

// The words an OpenID Connect entrance is set up in, and what the sign-in
// page or the account page says when a trip to the provider comes back
// without one.

const i18n = definePluginMessages({
  namespace: 'auth-oidc',
  messages: {
    kind: { id: 'auth-oidc/entrance/kind', defaultMessage: 'OpenID Connect' },
    issuer: { id: 'auth-oidc/field/issuer', defaultMessage: 'Issuer' },
    issuerHint: {
      id: 'auth-oidc/field/issuer-hint',
      defaultMessage: 'The provider’s address, exactly as its tokens name it',
    },
    discovery: { id: 'auth-oidc/field/discovery', defaultMessage: 'Endpoints' },
    discoveryAuto: {
      id: 'auth-oidc/field/discovery-auto',
      defaultMessage: 'Discover from the issuer',
    },
    discoveryManual: { id: 'auth-oidc/field/discovery-manual', defaultMessage: 'Enter by hand' },
    authorizationEndpoint: {
      id: 'auth-oidc/field/authorization-endpoint',
      defaultMessage: 'Authorization endpoint',
    },
    tokenEndpoint: { id: 'auth-oidc/field/token-endpoint', defaultMessage: 'Token endpoint' },
    jwksUri: { id: 'auth-oidc/field/jwks-uri', defaultMessage: 'Key set (JWKS) address' },
    userinfoEndpoint: {
      id: 'auth-oidc/field/userinfo-endpoint',
      defaultMessage: 'UserInfo endpoint',
    },
    clientId: { id: 'auth-oidc/field/client-id', defaultMessage: 'Client ID' },
    clientSecret: { id: 'auth-oidc/field/client-secret', defaultMessage: 'Client secret' },
    scopes: { id: 'auth-oidc/field/scopes', defaultMessage: 'Scopes' },
    scopesHint: {
      id: 'auth-oidc/field/scopes-hint',
      defaultMessage:
        'Separated by spaces; openid is always asked for. Empty means openid profile email',
    },
    tokenAuth: { id: 'auth-oidc/field/token-auth', defaultMessage: 'Client authentication' },
    tokenAuthAuto: { id: 'auth-oidc/field/token-auth-auto', defaultMessage: 'Automatic' },
    tokenAuthBasic: { id: 'auth-oidc/field/token-auth-basic', defaultMessage: 'HTTP Basic' },
    tokenAuthPost: { id: 'auth-oidc/field/token-auth-post', defaultMessage: 'In the request body' },
    clockSkew: { id: 'auth-oidc/field/clock-skew', defaultMessage: 'Clock tolerance, in seconds' },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof authOidcErrors>>()({
    AUTH_OIDC_REJECTED: {
      id: 'auth-oidc/error/rejected',
      defaultMessage: 'The identity provider did not confirm who you are. Try again.',
    },
    AUTH_OIDC_UNAVAILABLE: {
      id: 'auth-oidc/error/unavailable',
      defaultMessage: 'The identity provider cannot be reached right now. Try again later.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const oidcMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
