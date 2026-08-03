import type {
  ErrorMessageMap,
  MessageDescriptor,
  MessageValues,
  ValuesOf,
} from '@qualy/i18n-contract'

// framework-free error localization: turns a thrown api error into a
// localized sentence from its stable code and typed data. The backend's
// english message is a protocol fallback (openapi docs, non-browser
// clients, missing translations), never the primary display text.

// a message that declares placeholders demands them; one that declares
// none accepts an optional bag (an icu string can still interpolate without
// declaring it, which a formatting test catches)
export type FormatArgs<Values> = [keyof Values] extends [never]
  ? [values?: MessageValues]
  : [values: Values]

export interface MessageFormatter {
  format<Descriptor extends MessageDescriptor>(
    descriptor: Descriptor,
    ...args: FormatArgs<ValuesOf<Descriptor>>
  ): string
}

// orpc brands its errors on `name`, which survives module duplication in a
// way instanceof does not
interface ApiErrorShape {
  code: string
  status?: number
  data?: unknown
  message?: string
}

// public identification helpers: the ui must be able to tell "you are not
// signed in" from "the server is unreachable" before it decides what to
// render, and neither may be inferred from a failed query alone
export function isApiError(error: unknown): boolean {
  return asApiError(error) !== undefined
}

export function getApiErrorCode(error: unknown): string | undefined {
  return asApiError(error)?.code
}

export function isApiErrorCode(error: unknown, code: string): boolean {
  return asApiError(error)?.code === code
}

// the two codes that mean "no usable session", whatever produced them
export function isAuthenticationError(error: unknown): boolean {
  const code = getApiErrorCode(error)
  return code === 'AUTH_REQUIRED' || code === 'SESSION_EXPIRED'
}

export function isTransportError(error: unknown): boolean {
  return isNetworkError(error)
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

// as const keeps the message ids literal, which is what lets CatalogFor
// derive the exact key set the catalogs must cover
export const commonErrorMessages = {
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
} as const satisfies ErrorMessageMap

export const networkErrorMessage = {
  id: 'common/error/network',
  defaultMessage: 'Cannot reach the server. Check your connection and try again.',
} as const satisfies MessageDescriptor

export const unexpectedErrorMessage = {
  id: 'common/error/unexpected',
  defaultMessage: 'Something went wrong. Please try again.',
} as const satisfies MessageDescriptor

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
    const common: ErrorMessageMap = commonErrorMessages
    const registration = registry[apiError.code] ?? common[apiError.code]
    if (registration) {
      // the aggregate erased which code owns which data shape; the registry
      // itself was type-checked against its contract, so the projection is
      // safe here even though the static link is gone
      const values = registration.values?.(apiError.data as never)
      return formatter.format(registration.message, values ?? {})
    }
    if (apiError.message) return apiError.message
  }
  return formatter.format(unexpectedErrorMessage)
}
