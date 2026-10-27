import { describe, expect, it, vi } from 'vitest'
import {
  base64url,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from 'jose'
import { servedTypeOf } from '@qualy/plugin-storage/server'
import {
  DELIVERABLE_TYPES,
  deliverableFilename,
  filenameAccepted,
  MAX_LIFETIME_SECONDS,
  signGrant,
  TOKEN_TYPE,
  verifyGrant,
  type DownloadGrant,
} from '../src/edgeone/protocol.ts'

// The credential an EdgeOne delivery carries, read by the one module both
// ends use. Every case below is a token somebody could present at the edge;
// all but the honest one must grant nothing, and the reason given must never
// separate "genuine but late" from anything that was not genuine at all.

const ISSUER = 'https://qualy.example.cn'
const AUDIENCE = 'https://files.qualy.example.cn'
const NOW = 1_800_000_000

const pairOf = async (kid: string) => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }
  return { signing: { key: privateKey, kid }, jwk }
}

const ours = await pairOf('download-test')
const theirs = await pairOf('download-test')
const keys = createLocalJWKSet({ keys: [ours.jwk] })

const grant: DownloadGrant = {
  key: 'attachments/0190a7a0-0000-7000-8000-000000000001/0190a7a0-0000-7000-8000-000000000002',
  revision: 'MTg0NDQ5NTEwMjY3OTA2Nzg3MjE',
  filename: '获奖证书 (终版).pdf',
  mime: 'application/pdf',
}

const issue = (overrides: Partial<Parameters<typeof signGrant>[0]> = {}) =>
  signGrant({
    signing: ours.signing,
    issuer: ISSUER,
    audience: AUDIENCE,
    issuedAt: NOW,
    lifetime: 60,
    grant,
    ...overrides,
  })

const verify = (token: string, now = NOW) =>
  verifyGrant(token, { keys, issuer: ISSUER, audience: AUDIENCE, now })

/** a token signed with our key whose header and payload are whatever a case needs */
const forged = (header: Record<string, unknown>, payload: JWTPayload) =>
  new SignJWT(payload).setProtectedHeader({ alg: 'ES256', ...header }).sign(ours.signing.key)

const claims = {
  iss: ISSUER,
  aud: AUDIENCE,
  iat: NOW,
  exp: NOW + 60,
  k: grant.key,
  r: grant.revision,
  f: grant.filename,
  m: grant.mime,
}
const header = { typ: TOKEN_TYPE, kid: 'download-test' }

describe('a download credential', () => {
  it('grants exactly what was signed, and nothing a reader adds', async () => {
    expect(await verify(await issue())).toEqual({ ok: true, grant })
  })

  it('is an ES256 JWT of its own type, naming the key it was signed with', async () => {
    const [head] = (await issue()).split('.')
    expect(JSON.parse(new TextDecoder().decode(base64url.decode(head!)))).toEqual({
      alg: 'ES256',
      typ: TOKEN_TYPE,
      kid: 'download-test',
    })
  })

  it('reads an object without naming a version when the grant names none', async () => {
    const unversioned = { ...grant, revision: null }
    expect(await verify(await issue({ grant: unversioned }))).toEqual({
      ok: true,
      grant: unversioned,
    })
  })

  it('holds for its lifetime and a few seconds of clock difference, then is expired', async () => {
    const token = await issue()
    expect((await verify(token, NOW + 60)).ok).toBe(true)
    expect((await verify(token, NOW + 62)).ok).toBe(true)
    expect(await verify(token, NOW + 64)).toMatchObject({ ok: false, refusal: 'expired' })
  })

  it('is refused when it claims to be issued in the future', async () => {
    expect(await verify(await issue({ issuedAt: NOW + 30 }))).toMatchObject({
      ok: false,
      refusal: 'invalid',
    })
  })

  it('is never signed for longer than the ceiling', async () => {
    await expect(issue({ lifetime: MAX_LIFETIME_SECONDS + 1 })).rejects.toThrow()
    await expect(issue({ lifetime: 0 })).rejects.toThrow()
  })

  it('refuses a token whose lifetime runs past the ceiling, whoever signed it', async () => {
    const token = await forged(header, { ...claims, exp: NOW + MAX_LIFETIME_SECONDS + 1 })
    expect((await verify(token)).ok).toBe(false)
  })
})

describe('what grants nothing', () => {
  const refused = async (token: string, refusal = 'invalid') =>
    expect(await verify(token)).toMatchObject({ ok: false, refusal })

  it('a signature by any other key, even under the same kid', async () => {
    await refused(await issue({ signing: theirs.signing }))
  })

  it('a token for another file service, or from another issuer', async () => {
    await refused(await issue({ audience: 'https://files.elsewhere.cn' }))
    await refused(await issue({ issuer: 'https://elsewhere.cn' }))
  })

  it('any change to what was signed', async () => {
    const [head, body, signature] = (await issue()).split('.')
    const changed = JSON.parse(new TextDecoder().decode(base64url.decode(body!))) as Record<
      string,
      unknown
    >
    for (const [field, value] of [
      ['r', 'MTg0NDQ5NTEwMjY3OTA2MDA1OTc'],
      ['k', grant.key.replace(/2$/, '3')],
      ['f', 'other.pdf'],
      ['m', 'image/png'],
    ] as const) {
      const altered = base64url.encode(JSON.stringify({ ...changed, [field]: value }))
      await refused(`${head}.${altered}.${signature}`)
    }
  })

  it('a token of another type, or another algorithm', async () => {
    await refused(await forged({ ...header, typ: 'JWT' }, claims))
    // the library reads these as the same type; this profile does not
    await refused(await forged({ ...header, typ: `application/${TOKEN_TYPE}` }, claims))
    await refused(await forged({ ...header, typ: TOKEN_TYPE.toUpperCase() }, claims))
    // the confusion a verifier that let the token choose would fall for
    const hmac = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', ...header })
      .sign(new TextEncoder().encode('a shared secret of thirty-two bytes!'))
    await refused(hmac)
    const [, body] = (await issue()).split('.')
    const none = base64url.encode(JSON.stringify({ alg: 'none', ...header }))
    await refused(`${none}.${body}.`, 'malformed')
  })

  it('a header that points anywhere but the configured keys, or names one not there', async () => {
    await refused(await forged({ ...header, jku: 'https://evil.example/keys' }, claims))
    await refused(await forged({ ...header, kid: 'download-unknown' }, claims))
  })

  it('an audience that is a list, even one naming this file service', async () => {
    await refused(await forged(header, { ...claims, aud: [AUDIENCE] }))
    await refused(await forged(header, { ...claims, aud: [AUDIENCE, 'https://other.example'] }))
  })

  it('a payload missing a claim, or carrying one more', async () => {
    const { iat: _iat, ...withoutIat } = claims
    await refused(await forged(header, withoutIat))
    await refused(await forged(header, { ...claims, sub: 'someone' }))
  })

  it('claims of the wrong kind', async () => {
    await refused(await forged(header, { ...claims, iat: `${NOW}` as never }))
    await refused(await forged(header, { ...claims, iat: NOW + 0.5 }))
    await refused(await forged(header, { ...claims, r: 7 }))
  })

  it('a grant this protocol does not deliver', async () => {
    await refused(await forged(header, { ...claims, k: 'attachments/../../secrets' }))
    await refused(await forged(header, { ...claims, k: 'v1/x' }))
    await refused(await forged(header, { ...claims, m: 'text/html' }))
    await refused(await forged(header, { ...claims, f: 'a\r\nb.pdf' }))
    await refused(await forged(header, { ...claims, f: '\ud800.pdf' }))
    await refused(await forged(header, { ...claims, r: 'a b' }))
  })

  it('anything not shaped like a token at all', async () => {
    await refused('', 'malformed')
    await refused('not.a-token', 'malformed')
    await refused(`${'a'.repeat(4097)}.b.c`, 'malformed')
    await refused('a.b.c', 'invalid')
  })
})

describe('why nothing was granted', () => {
  it('is named by one of a few fixed details, never by what the error says', async () => {
    const [head, body, signature] = (await issue()).split('.')
    const altered = await verify(`${head}.${body}.${signature!.slice(0, -4)}AAAA`)
    expect(altered).toEqual({ ok: false, refusal: 'invalid', detail: 'jwt_signature' })
    expect(await verify(await issue(), NOW + 64)).toEqual({
      ok: false,
      refusal: 'expired',
      detail: 'jwt_expired',
    })
    expect(await verify(await issue({ issuer: 'https://elsewhere.cn' }))).toEqual({
      ok: false,
      refusal: 'invalid',
      detail: 'jwt_claims',
    })
  })

  it('is the service, not the link, when no verification could be made at all', async () => {
    const token = await issue()
    const failing = (error: unknown) =>
      verifyGrant(token, {
        keys: () => {
          throw error
        },
        issuer: ISSUER,
        audience: AUDIENCE,
        now: NOW,
      })
    // what the runtime said is not passed on, however it is worded
    expect(await failing(new TypeError('Param Invalid: secret-marker'))).toEqual({
      ok: false,
      refusal: 'unavailable',
      detail: 'verifier',
    })
  })

  it('is the service too when the signature check throws instead of answering', async () => {
    const token = await issue()
    const spy = vi.spyOn(crypto.subtle, 'verify').mockRejectedValueOnce(new Error('Param Invalid'))
    try {
      expect(await verify(token)).toEqual({ ok: false, refusal: 'unavailable', detail: 'verifier' })
    } finally {
      spy.mockRestore()
    }
  })
})

describe('the names and types a delivery carries', () => {
  it('makes any stored name deliverable without changing an ordinary one', () => {
    expect(deliverableFilename('获奖证书 (终版).pdf')).toBe('获奖证书 (终版).pdf')
    expect(deliverableFilename('a\r\nb.pdf')).toBe('a__b.pdf')
    expect(deliverableFilename('\ud800x.pdf')).toBe('�x.pdf')
    expect(deliverableFilename('')).toBe('file')
    const long = deliverableFilename(`${'名'.repeat(254)}😀`)
    expect(filenameAccepted(long)).toBe(true)
    for (const name of ['a\r\nb.pdf', '\udfffx', `${'名'.repeat(254)}😀`, '']) {
      expect(filenameAccepted(deliverableFilename(name))).toBe(true)
    }
  })

  it('covers every type core storage would serve', () => {
    for (const type of DELIVERABLE_TYPES) expect(servedTypeOf(type)).toBe(type)
    for (const declared of ['text/html', 'image/svg+xml', 'application/xml', 'video/mp4', '']) {
      expect(DELIVERABLE_TYPES.has(servedTypeOf(declared))).toBe(true)
    }
  })
})
