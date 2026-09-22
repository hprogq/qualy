import {
  defineErrorTranslations,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as authCasErrors from '../api.ts'

// The words a CAS entrance is set up in, and what the sign-in page says when
// a CAS sign-in comes back without one. The ids are the ones the driver's
// field declarations carry; the server sends the id, this is where it reads.

const i18n = definePluginMessages({
  namespace: 'auth-cas',
  messages: {
    kind: { id: 'auth-cas/entrance/kind', defaultMessage: 'CAS single sign-on' },
    serverUrl: { id: 'auth-cas/field/server-url', defaultMessage: 'CAS server address' },
    serverUrlHint: {
      id: 'auth-cas/field/server-url-hint',
      defaultMessage: 'The address the server’s pages sit under, such as https://cas.example.edu/cas',
    },
    protocol: { id: 'auth-cas/field/protocol', defaultMessage: 'Protocol' },
    protocolCas3: { id: 'auth-cas/field/protocol-cas3', defaultMessage: 'CAS 3.0' },
    protocolCas2: { id: 'auth-cas/field/protocol-cas2', defaultMessage: 'CAS 2.0' },
    protocolCas1: { id: 'auth-cas/field/protocol-cas1', defaultMessage: 'CAS 1.0' },
    protocolCustom: { id: 'auth-cas/field/protocol-custom', defaultMessage: 'Custom addresses' },
    identitySource: { id: 'auth-cas/field/identity-source', defaultMessage: 'Person identifier' },
    identityPrincipal: {
      id: 'auth-cas/field/identity-principal',
      defaultMessage: 'The name they sign in with',
    },
    identityAttribute: {
      id: 'auth-cas/field/identity-attribute-choice',
      defaultMessage: 'An attribute the server returns',
    },
    attributeName: { id: 'auth-cas/field/attribute-name', defaultMessage: 'Attribute name' },
    attributeNameHint: {
      id: 'auth-cas/field/attribute-name-hint',
      defaultMessage: 'Exactly as the server spells it, such as id_number',
    },
    fallback: {
      id: 'auth-cas/field/fallback',
      defaultMessage: 'Use the sign-in name when the attribute is missing',
    },
    loginUrl: { id: 'auth-cas/field/login-url', defaultMessage: 'Sign-in address' },
    validateUrl: { id: 'auth-cas/field/validate-url', defaultMessage: 'Ticket validation address' },
    customHint: {
      id: 'auth-cas/field/custom-hint',
      defaultMessage: 'Leave empty to use the CAS 3.0 address under the server address',
    },
    validateMethod: { id: 'auth-cas/field/validate-method', defaultMessage: 'Validation request' },
    validateGet: { id: 'auth-cas/field/validate-get', defaultMessage: 'GET' },
    validatePost: { id: 'auth-cas/field/validate-post', defaultMessage: 'POST form' },
    responseFormat: { id: 'auth-cas/field/response-format', defaultMessage: 'Answer format' },
    formatAuto: { id: 'auth-cas/field/format-auto', defaultMessage: 'Detect' },
    formatXml: { id: 'auth-cas/field/format-xml', defaultMessage: 'XML' },
    formatJson: { id: 'auth-cas/field/format-json', defaultMessage: 'JSON' },
    renew: {
      id: 'auth-cas/field/renew',
      defaultMessage: 'Ask for the password every time',
    },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof authCasErrors>>()({
    AUTH_CAS_TICKET_REJECTED: {
      id: 'auth-cas/error/ticket-rejected',
      defaultMessage: 'Single sign-on did not confirm who you are. Try again.',
    },
    AUTH_CAS_UPSTREAM_UNAVAILABLE: {
      id: 'auth-cas/error/upstream-unavailable',
      defaultMessage: 'Single sign-on cannot be reached right now. Try again later.',
    },
    AUTH_CAS_RESPONSE_INVALID: {
      id: 'auth-cas/error/response-invalid',
      defaultMessage: 'Single sign-on answered in a way Qualy cannot read. Contact an administrator.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const casMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
