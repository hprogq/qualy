import { type CommonErrorCode } from '@qualy/i18n-contract'
import * as m from '#messages'

// framework-free error localization: turns a thrown api error into a
// localized sentence from its stable code and typed data. The backend's
// english message serves non-browser clients. Use cases own domain failures;
// this module formats only the platform failures and a localized fallback.

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

/**
 * Whether the server is between processes rather than broken.
 *
 * In development the backend is replaced while the page stays open, and for a
 * second or two there is either nothing on the port or a process that has
 * bound it and not finished building itself. Both answer 503 and both say so
 * in a header, because a status alone cannot tell "wait a moment" from "this
 * failed" - and those want opposite things from the page.
 *
 * Read off the response rather than the message: which of the client's error
 * reasons carries it depends on whether the body decoded, and all of them
 * carry the response.
 */
const TRANSIENT_STATES = new Set(['starting', 'unavailable'])

export function isBackendUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const response = (error as { response?: { status?: unknown; headers?: unknown } }).response
  if (!response || typeof response !== 'object') return false
  if (response.status !== 503) return false
  const headers = response.headers as Record<string, string | undefined> | undefined
  const state = headers?.['x-qualy-state']
  return typeof state === 'string' && TRANSIENT_STATES.has(state)
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
    // Available for protocol inspection, never displayed by the formatter.
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
export const commonErrorMessages: Record<CommonErrorCode, (error: unknown) => string> = {
  AUTH_REQUIRED: () => m.error_authRequired(),
  SESSION_EXPIRED: () => m.error_sessionExpired(),
  ACCESS_DENIED: () => m.error_accessDenied(),
  BAD_REQUEST: () => m.error_badRequest(),
  TOO_MANY_ATTEMPTS: (error) => {
    const seconds = (error as { retryAfterSeconds?: number }).retryAfterSeconds ?? 0
    return m.error_tooManyAttempts({ minutes: Math.max(1, Math.ceil(seconds / 60)) })
  },
  REQUEST_ORIGIN_REFUSED: () => m.error_requestOriginRefused(),
  API_ROUTE_NOT_FOUND: () => m.error_apiRouteNotFound(),
  QUALY_CLIENT_PROTOCOL_UNSUPPORTED: () => m.error_clientUnsupported(),
  QUALY_CLIENT_ASSEMBLY_UNSUPPORTED: () => m.error_clientUnsupported(),
  QUALY_CLIENT_RELEASE_UNSUPPORTED: () => m.error_clientUnsupported(),
  SERVICE_UNAVAILABLE: () => m.error_serviceUnavailable(),
}

/** Platform failures only; domain failures belong to their use case. */
export function formatPlatformFailure(error: unknown): string {
  if (isNetworkError(error)) return m.error_network()
  const code = getApiErrorCode(error)
  if (code !== undefined && Object.hasOwn(commonErrorMessages, code))
    return commonErrorMessages[code as CommonErrorCode](error)
  return m.error_unexpected()
}

export type UseCaseApiFailure<E> = E extends { readonly _tag: infer Tag extends string }
  ? Tag extends Uppercase<Tag>
    ? Tag extends CommonErrorCode
      ? never
      : E
    : never
  : never

/** Separate transport/platform failures while preserving the endpoint's domain union. */
export function isUseCaseApiFailure<E>(error: E): error is E & UseCaseApiFailure<E> {
  const code = getApiErrorCode(error)
  if (
    code === undefined ||
    !/^[A-Z][A-Z0-9_]*$/.test(code) ||
    isTransportError(error) ||
    Object.hasOwn(commonErrorMessages, code)
  )
    return false
  return true
}

export function assertNever(value: never): never {
  throw new Error(`unhandled domain failure: ${String(getApiErrorCode(value))}`)
}
