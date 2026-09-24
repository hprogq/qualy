import { describe, expect, it } from 'vitest'
import { driver } from '../src/index.ts'
import { scopeOf, settingsOf, sortFailure } from '../src/oidc.ts'

// What an entrance's settings turn into before the library sees them, and
// how a failure is told apart: the provider refusing, or not being reachable.

describe('an OpenID Connect entrance', () => {
  it('always asks for openid, whatever was typed', () => {
    expect(scopeOf(undefined)).toBe('openid profile email')
    expect(scopeOf('profile  email')).toBe('openid profile email')
    expect(scopeOf('openid groups')).toBe('openid groups')
  })

  it('runs from discovery by default, and from every endpoint it needs when entered by hand', () => {
    expect(settingsOf({ issuer: 'https://id.example.edu', clientId: 'c' })).toEqual({
      issuer: 'https://id.example.edu',
      clientId: 'c',
      scope: 'openid profile email',
      tokenAuth: 'auto',
      clockSkewSeconds: 60,
    })
    const partial = {
      issuer: 'https://id.example.edu',
      clientId: 'c',
      discoveryMode: 'manual',
      authorizationEndpoint: 'https://id.example.edu/auth',
      tokenEndpoint: 'https://id.example.edu/token',
    }
    expect(settingsOf(partial)).toBeUndefined()
    expect(
      settingsOf({ ...partial, jwksUri: 'https://id.example.edu/keys', clockSkewSeconds: 0 }),
    ).toMatchObject({
      clockSkewSeconds: 0,
      manual: { jwksUri: 'https://id.example.edu/keys' },
    })
  })

  it('names the issuer and the client as whose accounts it speaks for, and nothing else', () => {
    const provisioning = driver.provisioning
    expect(
      provisioning.mode === 'tenant-managed' && provisioning.entrance.identityNamespaceKeys,
    ).toEqual(['issuer', 'clientId'])
  })

  it('tells a provider that refused from one that could not be asked', () => {
    expect(
      sortFailure({ name: 'ResponseBodyError', code: 'OAUTH_RESPONSE_BODY_ERROR', status: 400 })
        .kind,
    ).toBe('rejected')
    expect(sortFailure({ name: 'ResponseBodyError', status: 503 }).kind).toBe('unavailable')
    expect(
      sortFailure({ name: 'ClientError', cause: { _tag: 'OutboundRefused', reason: 'metadata' } }),
    ).toEqual({ kind: 'unavailable', reason: 'OutboundRefused:metadata' })
  })
})
