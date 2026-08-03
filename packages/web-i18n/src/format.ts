import type { ErrorMessageMap, MessageDescriptor } from '@qualy/i18n-contract'

// framework-free error localization: turns a thrown api error into a
// localized sentence from its stable code and typed data. The backend's
// english message is a protocol fallback (openapi docs, non-browser
// clients, missing translations), never the primary display text.

export interface MessageFormatter {
  format(descriptor: MessageDescriptor, values?: Record<string, unknown>): string
}

// orpc brands its errors on `name`, which survives module duplication in a
// way instanceof does not
interface ApiErrorShape {
  code: string
  status?: number
  data?: unknown
  message?: string
}

function asApiError(error: unknown): ApiErrorShape | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { name?: unknown; code?: unknown }
  if (candidate.name !== 'ORPCError' || typeof candidate.code !== 'string') return undefined
  return error as unknown as ApiErrorShape
}

// a failed fetch never reaches the server, so there is no code to key on
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')
}

export const commonErrorMessages: ErrorMessageMap = {
  AUTH_REQUIRED: {
    message: { id: 'common/error/auth-required', defaultMessage: 'Please sign in to continue.' },
  },
  SESSION_EXPIRED: {
    message: {
      id: 'common/error/session-expired',
      defaultMessage: 'Your session has expired. Please sign in again.',
    },
  },
  FORBIDDEN: {
    message: {
      id: 'common/error/forbidden',
      defaultMessage: 'You are not allowed to perform this action.',
    },
  },
  NOT_FOUND: {
    message: { id: 'common/error/not-found', defaultMessage: 'The requested item was not found.' },
  },
  INPUT_VALIDATION_FAILED: {
    message: { id: 'common/error/invalid-input', defaultMessage: 'Some input is invalid.' },
  },
  INTERNAL_SERVER_ERROR: {
    message: { id: 'common/error/internal', defaultMessage: 'Something went wrong on the server.' },
  },
}

export const networkErrorMessage: MessageDescriptor = {
  id: 'common/error/network',
  defaultMessage: 'Cannot reach the server. Check your connection and try again.',
}

export const unexpectedErrorMessage: MessageDescriptor = {
  id: 'common/error/unexpected',
  defaultMessage: 'Something went wrong. Please try again.',
}

// resolution order: transport failure, plugin-owned code, common code,
// backend english message, generic fallback
export function formatApiError(
  error: unknown,
  formatter: MessageFormatter,
  registry: ErrorMessageMap = {},
): string {
  if (isNetworkError(error)) return formatter.format(networkErrorMessage)
  const apiError = asApiError(error)
  if (apiError) {
    const registration = registry[apiError.code] ?? commonErrorMessages[apiError.code]
    if (registration) {
      const values = registration.values?.(apiError.data)
      return formatter.format(registration.message, values)
    }
    if (apiError.message) return apiError.message
  }
  return formatter.format(unexpectedErrorMessage)
}
