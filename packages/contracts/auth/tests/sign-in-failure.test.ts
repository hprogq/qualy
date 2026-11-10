import { describe, expect, it } from 'vitest'
import { failureLocation } from '../src/sign-in-failure.ts'

describe('sign-in failure return locations', () => {
  const failure = { _tag: 'AUTH_REAUTHENTICATION_REQUIRED', retryAfterSeconds: 12 }
  const origin = 'https://qualy.example'

  it('preserves a safe page and its query while setting failure details', () => {
    expect(failureLocation('/account/../account/logins?tab=external#section', failure)).toBe(
      '/account/logins?tab=external&error=AUTH_REAUTHENTICATION_REQUIRED&retryAfter=12',
    )
  })

  it('falls back when browser normalization would leave the application', () => {
    for (const path of [
      'https://elsewhere.example/path',
      '//elsewhere.example/path',
      '/\\elsewhere.example/path',
      '/.//elsewhere.example/path',
      '/%2e//elsewhere.example/path',
      '/a/..//elsewhere.example/path',
      '/./\\elsewhere.example/path',
      'relative/path',
      `/${'x'.repeat(2049)}`,
    ]) {
      const location = failureLocation(path, failure)
      expect(location, path).toBe('/login?error=AUTH_REAUTHENTICATION_REQUIRED&retryAfter=12')
      expect(new URL(location, origin).origin, path).toBe(origin)
    }
  })
})
