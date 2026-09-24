import { describe, expect, it } from 'vitest'
import { isDemoAccount, parseDemoAccounts } from '../src/server/demo-accounts.ts'

// The accounts a demonstration deployment names, read from the environment:
// a shape it cannot read stops the boot rather than locking nothing.

describe('the demo accounts a deployment names', () => {
  it('are read from a JSON list, addresses normalised', () => {
    expect(
      parseDemoAccounts('[{"email":" Student@Demo.example.edu ","password":"p","label":"学生"}]'),
    ).toEqual([{ email: 'student@demo.example.edu', password: 'p', label: '学生' }])
    expect(parseDemoAccounts('')).toEqual([])
  })

  it('refuse anything that is not that list', () => {
    for (const raw of ['{}', '[1]', '[{"email":"a@b.cn","password":"","label":"x"}]', 'not json']) {
      expect(parseDemoAccounts(raw), raw).toBeUndefined()
    }
  })

  it('match an address however it is written, and nothing when none are named', () => {
    const accounts = parseDemoAccounts(
      '[{"email":"a@demo.example.edu","password":"p","label":"x"}]',
    )!
    expect(isDemoAccount(accounts, 'A@Demo.Example.edu')).toBe(true)
    expect(isDemoAccount(accounts, 'b@demo.example.edu')).toBe(false)
    expect(isDemoAccount(undefined, 'a@demo.example.edu')).toBe(false)
    expect(isDemoAccount(accounts, null)).toBe(false)
  })
})
