import nodeCrypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { derSignatureOf } from '../src/edgeone/webcrypto.ts'

// The one re-encoding the edge adapter does by hand: an ES256 signature from
// the r || s a JWS carries to the DER a runtime like EdgeOne's reads. OpenSSL
// is the judge of the result, not this module's own reading of it.

const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const data = new TextEncoder().encode('header.payload')

describe('an ES256 signature in DER', () => {
  it('is what OpenSSL reads as the same signature, whatever r and s happen to be', () => {
    // enough signatures that r with the high bit set and without it both turn
    // up; leading zero bytes are rare enough to be built by the next case
    const shapes = new Set<string>()
    for (let i = 0; i < 400; i++) {
      const signature = nodeCrypto.sign('sha256', data, {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      })
      const der = derSignatureOf(new Uint8Array(signature))
      expect(nodeCrypto.verify('sha256', data, { key: publicKey, dsaEncoding: 'der' }, der)).toBe(
        true,
      )
      shapes.add(signature[0]! >= 0x80 ? 'high' : signature[0] === 0 ? 'zero' : 'plain')
    }
    expect(shapes).toContain('high')
    expect(shapes).toContain('plain')
  })

  it('keeps each integer minimal and positive', () => {
    const signature = new Uint8Array(64)
    signature[2] = 0x01 // r = 0x01 << 232, two leading zero bytes
    signature[32] = 0x80 // s with the high bit set
    const der = derSignatureOf(signature)
    expect(Array.from(der.subarray(0, 4))).toEqual([0x30, der.length - 2, 0x02, 30])
    expect(der[4]).toBe(0x01)
    const s = der.subarray(4 + 30)
    expect(Array.from(s.subarray(0, 4))).toEqual([0x02, 33, 0x00, 0x80])
  })
})
