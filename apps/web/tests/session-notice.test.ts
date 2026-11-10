import { describe, expect, it } from 'vitest'
import { recoveryReturn } from '@qualy/ui-contract/session-notice'

describe('external sign-in recovery destination', () => {
  it('reserves only the login recovery route for the recovery handshake', () => {
    expect(recoveryReturn('/login?resume=1')).toBe(true)
    expect(recoveryReturn('/login?resume=1&next=%2Fwork')).toBe(true)
    for (const path of [
      undefined,
      '/login',
      '/work?resume=1',
      '/login?resume=0',
      'https://other.example/login?resume=1',
    ]) {
      expect(recoveryReturn(path)).toBe(false)
    }
  })
})
