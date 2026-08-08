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

/**
 * A failure the api declared, whichever client produced it.
 *
 * The derived client decodes a declared failure into its tagged class, so the
 * code is `_tag` and the payload is the instance's own fields rather than a
 * `data` envelope. Reading the tag is what survives module duplication, the
 * same property that made oRPC brand `name` instead of relying on instanceof.
 */
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

// codes are upper snake case by declaration, which is what tells a declared
// failure apart from Effect's own tagged internals (SchemaError and friends)
const DECLARED_CODE = /^[A-Z][A-Z0-9_]*$/

function asApiError(error: unknown): ApiErrorShape | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { _tag?: unknown }
  if (typeof candidate._tag !== 'string' || !DECLARED_CODE.test(candidate._tag)) return undefined
  return {
    code: candidate._tag,
    // the fields are on the instance, so the instance is its own data
    data: error,
    // and the english sentence the server sends for clients that do not
    // localize, which is the last thing between an untranslated code and
    // "something went wrong"
    message: error instanceof Error ? error.message : undefined,
  }
}

// A failed fetch never reaches the server, so there is no code to key on.
//
// What arrives is not the fetch's own TypeError: the api runtime goes through
// Effect's http client, which wraps it as an HttpClientError whose `reason`
// says which stage failed. Checking only for TypeError therefore matched
// nothing a screen actually sees, and every unreachable server rendered as
// the generic "something went wrong" - the one distinction these helpers
// exist to make. The bare forms stay for callers outside that runtime.
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (error instanceof Error && error.name === 'AbortError') return true
  const candidate = error as { _tag?: unknown; reason?: { _tag?: unknown } } | null
  if (!candidate || typeof candidate !== 'object') return false
  return candidate._tag === 'HttpClientError' && candidate.reason?._tag === 'TransportError'
}

// The codes every plugin's endpoints can answer with, because they come from
// the request pipeline rather than from a domain.
//
// Exactly what the shared packages declare, which scripts/tests/error-codes
// checks: this table used to hold FORBIDDEN, NOT_FOUND, INPUT_VALIDATION_FAILED
// and INTERNAL_SERVER_ERROR - the codes the oRPC boundary produced - while what
// arrives now is ACCESS_DENIED and BAD_REQUEST. Every one of those four
// translations was unreachable, and the two that do arrive fell through to the
// english message the server sends for non-browser clients.
//
// as const keeps the message ids literal, which is what lets CatalogFor derive
// the exact key set the catalogs must cover.
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
  ACCESS_DENIED: {
    message: {
      id: 'common/error/access-denied',
      defaultMessage: 'You are not allowed to perform this action.',
    },
  },
  BAD_REQUEST: {
    message: { id: 'common/error/bad-request', defaultMessage: 'Some input is invalid.' },
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
