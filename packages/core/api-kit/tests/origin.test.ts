import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { originVerdict, publicHostOf } from '../src/origin.ts'
import { trustedProxies } from '../src/request.ts'

// The origin rule on the strings alone, as a table: which requests the
// browser vouches for, which it does not, and what a client that says
// nothing is taken for.

describe('the origin verdict', () => {
  const cases: readonly [
    method: string,
    secFetchSite: string | undefined,
    origin: string | undefined,
    publicHost: string | undefined,
    verdict: 'allow' | 'refuse',
  ][] = [
    ['GET', 'cross-site', undefined, undefined, 'allow'],
    ['POST', 'same-origin', undefined, undefined, 'allow'],
    ['POST', 'none', undefined, undefined, 'allow'],
    ['POST', 'same-site', undefined, undefined, 'refuse'],
    ['POST', 'cross-site', undefined, undefined, 'refuse'],
    ['POST', undefined, 'https://qualy.example', 'qualy.example', 'allow'],
    ['POST', undefined, 'https://evil.example', 'qualy.example', 'refuse'],
    ['POST', undefined, 'null', 'qualy.example', 'refuse'],
    ['POST', undefined, undefined, 'qualy.example', 'allow'],
    ['DELETE', undefined, 'http://qualy.example:5173', 'qualy.example:5173', 'allow'],
  ]
  for (const [method, secFetchSite, origin, publicHost, verdict] of cases) {
    it(`${verdict}s ${method} with sec-fetch-site ${secFetchSite ?? '-'}, origin ${origin ?? '-'}, host ${publicHost ?? '-'}`, () => {
      expect(originVerdict({ method, secFetchSite, origin, publicHost })).toBe(verdict)
    })
  }

  it('refuses any fetch-metadata value it does not know', () => {
    expect(
      originVerdict({ method: 'PUT', secFetchSite: 'unknown', origin: undefined, publicHost: 'h' }),
    ).toBe('refuse')
  })

  it('lets every safe method through whatever it carries', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(
        originVerdict({
          method,
          secFetchSite: 'cross-site',
          origin: 'https://evil.example',
          publicHost: 'qualy.example',
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
