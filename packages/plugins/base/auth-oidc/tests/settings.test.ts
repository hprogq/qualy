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

  it('names the issuer, the client and where keys and tokens come from as whose accounts it speaks for', () => {
    const provisioning = driver.provisioning
    expect(
      provisioning.mode === 'tenant-managed' && provisioning.entrance.identityNamespaceKeys,
    ).toEqual([
      'issuer',
      'clientId',
      'discoveryMode',
      'authorizationEndpoint',
      'tokenEndpoint',
      'jwksUri',
      'userinfoEndpoint',
    ])
    // how it asks and how long it waits are not about who anybody is
    const keys =
      provisioning.mode === 'tenant-managed'
        ? (provisioning.entrance.identityNamespaceKeys ?? [])
        : []
    for (const setting of ['scopes', 'tokenAuthMethod', 'clockSkewSeconds', 'clientSecret']) {
      expect(keys).not.toContain(setting)
    }
  })

  it('is offered for showing it is you again, through a sign-in asked for afresh', () => {
    expect(driver.provesPresence?.({ config: {} })).toBe(true)
    const href = new URL(driver.reauthenticate!({ code: 'op' }), 'http://qualy.invalid')
    expect(href.searchParams.get('intent')).toBe('reauthenticate')
    // an ordinary sign-in does not ask afresh
    const plain =
      driver.presentation.mode === 'redirect' ? driver.presentation.href({ code: 'op' }) : ''
    expect(new URL(plain, 'http://qualy.invalid').searchParams.get('intent')).toBeNull()
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
