import { describe, expect, it } from 'vitest'
import { recentLoginMethod } from '../src/recent-method.ts'

describe('the recent login method preference', () => {
  it('reads an encoded method without mistaking another cookie for it', () => {
    expect(recentLoginMethod('other=value; qualy_login_method=school%2Fsso')).toBe('school/sso')
    expect(recentLoginMethod('prefix_qualy_login_method=local')).toBeNull()
    expect(recentLoginMethod(undefined)).toBeNull()
  })

  it('ignores malformed or unbounded values', () => {
    for (const value of ['%zz', '%00local', 'a'.repeat(129), '']) {
      expect(recentLoginMethod(`qualy_login_method=${value}`)).toBeNull()
    }
  })
})
