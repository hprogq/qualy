import { describe, expect, it } from 'vitest'
import { validateComponentKeys } from '../lib/component-keys.ts'

describe('component key namespace', () => {
  it('accepts keys under the plugin namespace', () => {
    expect(() =>
      validateComponentKeys('@qualy/plugin-auth-local', ['auth-local/LoginMethod']),
    ).not.toThrow()
  })

  it('rejects foreign or missing namespaces', () => {
    expect(() => validateComponentKeys('@qualy/plugin-ping', ['LoginPage'])).toThrow(/namespace/)
    expect(() => validateComponentKeys('@qualy/plugin-ping', ['auth/LoginPage'])).toThrow(
      /namespace/,
    )
    expect(() => validateComponentKeys('@qualy/plugin-ping', ['ping/'])).toThrow(/component name/)
  })
})
