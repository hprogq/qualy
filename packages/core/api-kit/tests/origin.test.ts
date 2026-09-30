import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { originVerdict, publicHostOf, publicOriginOf } from '../src/origin.ts'
import { trustedProxies } from '../src/request.ts'

// The origin rule on the strings alone, as a table: which requests the
// browser vouches for, which it does not, and what a client that says
// nothing is taken for.

describe('the origin verdict', () => {
  const cases: readonly [
    method: string,
    secFetchSite: string | undefined,
    origin: string | undefined,
    publicOrigin: string | undefined,
    verdict: 'allow' | 'refuse',
  ][] = [
    ['GET', 'cross-site', undefined, undefined, 'allow'],
    ['POST', 'same-origin', undefined, undefined, 'allow'],
    // started from the browser's own chrome: never how this application writes
    ['POST', 'none', undefined, undefined, 'refuse'],
    ['POST', 'same-site', undefined, undefined, 'refuse'],
    ['POST', 'cross-site', undefined, undefined, 'refuse'],
    ['POST', undefined, 'https://qualy.example', 'https://qualy.example', 'allow'],
    // the same host is not the same origin
    ['POST', undefined, 'http://qualy.example', 'https://qualy.example', 'refuse'],
    ['POST', undefined, 'https://qualy.example:8443', 'https://qualy.example', 'refuse'],
    ['POST', undefined, 'https://evil.example', 'https://qualy.example', 'refuse'],
    ['POST', undefined, 'null', 'https://qualy.example', 'refuse'],
    ['POST', undefined, undefined, 'https://qualy.example', 'allow'],
    ['DELETE', undefined, 'http://qualy.example:5173', 'http://qualy.example:5173', 'allow'],
  ]
  for (const [method, secFetchSite, origin, publicOrigin, verdict] of cases) {
    it(`${verdict}s ${method} with sec-fetch-site ${secFetchSite ?? '-'}, origin ${origin ?? '-'}, addressed ${publicOrigin ?? '-'}`, () => {
      expect(originVerdict({ method, secFetchSite, origin, publicOrigin })).toBe(verdict)
    })
  }

  it('refuses any fetch-metadata value it does not know', () => {
    expect(
      originVerdict({
        method: 'PUT',
        secFetchSite: 'unknown',
        origin: undefined,
        publicOrigin: 'https://h',
      }),
    ).toBe('refuse')
  })

  it('lets every safe method through whatever it carries', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(
        originVerdict({
          method,
          secFetchSite: 'cross-site',
          origin: 'https://evil.example',
          publicOrigin: 'https://qualy.example',
        }),
      ).toBe('allow')
    }
  })
})

describe('the public host', () => {
  const request = (remote: string, headers: Record<string, string>) => ({
    headers,
    remoteAddress: Option.some(remote),
  })

  it('takes the Host header when the peer is not a trusted proxy, forwarded or not', () => {
    const untrusted = trustedProxies([])
    expect(
      publicHostOf(
        request('203.0.113.7', { host: 'qualy.example', 'x-forwarded-host': 'evil.example' }),
        untrusted,
      ),
    ).toBe('qualy.example')
  })

  it('takes the first forwarded host when the peer is a trusted proxy', () => {
    const trusted = trustedProxies(['10.0.0.1'])
    expect(
      publicHostOf(
        request('10.0.0.1', {
          host: 'internal:3000',
          'x-forwarded-host': 'qualy.example, proxy.internal',
        }),
        trusted,
      ),
    ).toBe('qualy.example')
  })

  it('takes the Host header when the trusted proxy forwarded nothing', () => {
    const trusted = trustedProxies(['10.0.0.1'])
    expect(publicHostOf(request('10.0.0.1', { host: 'qualy.example' }), trusted)).toBe(
      'qualy.example',
    )
  })
})

describe('the public origin', () => {
  const request = (remote: string, headers: Record<string, string>) => ({
    headers,
    remoteAddress: Option.some(remote),
  })

  it('takes the scheme a trusted proxy forwarded, with the host it forwarded', () => {
    const trusted = trustedProxies(['10.0.0.1'])
    expect(
      publicOriginOf(
        request('10.0.0.1', {
          host: 'internal:3000',
          'x-forwarded-host': 'qualy.example',
          'x-forwarded-proto': 'https',
        }),
        trusted,
      ),
    ).toBe('https://qualy.example')
  })

  it('believes no forwarded scheme from anybody else: the socket is plain http', () => {
    expect(
      publicOriginOf(
        request('203.0.113.7', { host: 'qualy.example', 'x-forwarded-proto': 'https' }),
        trustedProxies([]),
      ),
    ).toBe('http://qualy.example')
  })

  it('writes the default port the way a browser writes its Origin header, without it', () => {
    const trusted = trustedProxies(['10.0.0.1'])
    expect(
      publicOriginOf(
        request('10.0.0.1', { host: 'qualy.example:443', 'x-forwarded-proto': 'https' }),
        trusted,
      ),
    ).toBe('https://qualy.example')
  })

  it('is unknown for a request that names no host', () => {
    expect(publicOriginOf(request('10.0.0.1', {}), trustedProxies(['10.0.0.1']))).toBeUndefined()
  })
})
