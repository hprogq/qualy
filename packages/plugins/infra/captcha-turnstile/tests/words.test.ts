import { describe, expect, it } from 'vitest'
import { actionOfPurpose, hostnameOfPublicHost, meaningOfRefusal } from '../src/server/index.ts'

// The translations Siteverify depends on, at their edges.

describe('a purpose as a Turnstile action', () => {
  it('keeps a short one readable', () => {
    expect(actionOfPurpose('auth/login')).toBe('auth_login')
    expect(actionOfPurpose('auth/password-reset')).toBe('auth_password-reset')
  })

  it('keeps one of 31 and 32 characters, and hashes one of 33', () => {
    const of = (length: number) => `a/${'b'.repeat(length - 2)}`
    expect(actionOfPurpose(of(31))).toBe(of(31).replace('/', '_'))
    expect(actionOfPurpose(of(32))).toBe(of(32).replace('/', '_'))
    const hashed = actionOfPurpose(of(33))
    expect(hashed).toMatch(/^q_[0-9a-f]{30}$/)
    expect(hashed).toHaveLength(32)
  })

  it('never lets two long purposes sharing a start collide, and says the same thing twice', () => {
    const shared = `assessment/${'x'.repeat(40)}`
    expect(actionOfPurpose(`${shared}-one`)).not.toBe(actionOfPurpose(`${shared}-two`))
    expect(actionOfPurpose(`${shared}-one`)).toBe(actionOfPurpose(`${shared}-one`))
  })
})

describe('the host a browser addressed', () => {
  it('drops the port, a trailing dot and case', () => {
    expect(hostnameOfPublicHost('Qualy.Example.EDU:8443')).toBe('qualy.example.edu')
    expect(hostnameOfPublicHost('qualy.example.edu.')).toBe('qualy.example.edu')
    expect(hostnameOfPublicHost('qualy.example.edu')).toBe('qualy.example.edu')
  })

  it('reads an IPv6 address rather than cutting it at the first colon', () => {
    expect(hostnameOfPublicHost('[2001:db8::1]:8443')).toBe('[2001:db8::1]')
  })

  it('answers nothing for a host that is missing or does not parse', () => {
    expect(hostnameOfPublicHost(undefined)).toBeUndefined()
    expect(hostnameOfPublicHost('')).toBeUndefined()
    expect(hostnameOfPublicHost('bad host with spaces')).toBeUndefined()
  })
})

describe('a refusal from Siteverify', () => {
  it('is a rejected token only when every code says the token is no proof', () => {
    expect(meaningOfRefusal(['invalid-input-response'])).toEqual({ kind: 'rejected' })
    expect(meaningOfRefusal(['timeout-or-duplicate'])).toEqual({ kind: 'rejected' })
    expect(meaningOfRefusal(['missing-input-response'])).toEqual({ kind: 'rejected' })
  })

  it('is Cloudflare being unable to answer, which lets the request through', () => {
    expect(meaningOfRefusal(['internal-error'])).toEqual({ kind: 'unavailable', defect: undefined })
  })

  it('is this deployment misconfigured, said loudly', () => {
    for (const code of ['missing-input-secret', 'invalid-input-secret']) {
      expect(meaningOfRefusal([code])).toMatchObject({
        kind: 'unavailable',
        defect: expect.stringContaining('misconfigured'),
      })
    }
  })

  it('is this integration at fault for a code it does not know, never the person', () => {
    expect(meaningOfRefusal(['bad-request'])).toMatchObject({
      kind: 'unavailable',
      defect: expect.stringContaining('bad-request'),
    })
    expect(meaningOfRefusal(['something-new'])).toMatchObject({ kind: 'unavailable' })
    expect(meaningOfRefusal([])).toMatchObject({ kind: 'unavailable' })
    // one such code decides it, whatever else is listed
    expect(meaningOfRefusal(['invalid-input-response', 'bad-request'])).toMatchObject({
      kind: 'unavailable',
    })
  })
})
