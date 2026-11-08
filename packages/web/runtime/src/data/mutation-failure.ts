import {
  formatPlatformFailure,
  getApiErrorCode,
  isUseCaseApiFailure,
  isTransportError,
} from '@qualy/web-i18n'

export interface RateLimit {
  readonly retryAfterSeconds: number
}

export interface MutationFailurePolicy {
  notify(message: string, code: string): void
  diagnose(code: string): void
  capture(error: unknown): void
  onRateLimited?: (limit: RateLimit) => unknown
}

/** Session recovery and release recovery already run before this boundary. */
export function handlePlatformFailure(error: unknown, policy: MutationFailurePolicy): boolean {
  if (isUseCaseApiFailure(error)) return false
  const code = getApiErrorCode(error)
  if (code === 'TOO_MANY_ATTEMPTS' && policy.onRateLimited) {
    const seconds = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds
    policy.onRateLimited({
      retryAfterSeconds:
        typeof seconds === 'number' && Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
    })
    return true
  }
  // The transport has already notified the release coordinator. Its refresh
  // prompt owns this refusal; a second toast adds no information.
  if (code?.startsWith('QUALY_CLIENT_')) return true
  if (
    code === 'BAD_REQUEST' ||
    code === 'REQUEST_ORIGIN_REFUSED' ||
    code === 'API_ROUTE_NOT_FOUND'
  ) {
    policy.diagnose(code)
  }
  policy.notify(formatPlatformFailure(error), code ?? 'UNEXPECTED_FAILURE')
  if (code === undefined && !isTransportError(error)) policy.capture(error)
  return true
}
