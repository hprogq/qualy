import { defineErrorMessages, type PluginCatalogs } from '@qualy/i18n-contract'
import type { ApiErrorCode, CommonErrorCode, MessageDescriptor } from '@qualy/i18n-contract'
import type { AuthLocalContractError } from '../src/contract.ts'

export const localMessages = {
  identifier: { id: 'auth-local/field/identifier', defaultMessage: 'Username' },
  password: { id: 'auth-local/field/password', defaultMessage: 'Password' },
  submit: { id: 'auth-local/action/submit', defaultMessage: 'Sign in' },
  submitting: { id: 'auth-local/action/submitting', defaultMessage: 'Signing in…' },
} as const satisfies Record<string, MessageDescriptor>

export const localErrorTexts = {
  invalidCredentials: {
    id: 'auth-local/error/invalid-credentials',
    defaultMessage: 'Incorrect username or password.',
  },
} as const satisfies Record<string, MessageDescriptor>

type OwnedErrorCode = Exclude<ApiErrorCode<AuthLocalContractError>, CommonErrorCode>

export const errorMessages = defineErrorMessages<AuthLocalContractError, OwnedErrorCode>()({
  INVALID_CREDENTIALS: { message: localErrorTexts.invalidCredentials },
})

export const localDeclaredMessages = {
  ...localMessages,
  ...localErrorTexts,
} as const satisfies Record<string, MessageDescriptor>

export const catalogs: PluginCatalogs = {
  namespace: 'auth-local',
  messages: Object.values(localDeclaredMessages),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
}
