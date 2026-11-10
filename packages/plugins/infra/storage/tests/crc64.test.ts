import { describe, expect, it } from 'vitest'
import { Crc64 } from '../src/cli/crc64.ts'

// Vectors from Go's hash/crc64.Checksum with MakeTable(ECMA), also used by
// Tencent's COS Go SDK. They include bytes above 0x7f and values above 2^53.
describe('COS CRC64', () => {
  it.each([
    [Buffer.alloc(0), '0'],
    [Buffer.from('123456789'), '11051210869376104954'],
    [Buffer.from('original'), '16684194152576135820'],
    [Buffer.from([0, 255, 128]), '9140025445858914778'],
  ])('matches the ECMA checksum independently of chunk boundaries', (bytes, expected) => {
    for (let split = 0; split <= bytes.length; split++) {
      const crc = new Crc64()
      crc.update(bytes.subarray(0, split))
      crc.update(bytes.subarray(split))
      expect(crc.decimal()).toBe(expected)
    }
  })

  it('matches a one-megabyte binary vector across uneven chunks', () => {
    const bytes = Uint8Array.from({ length: 1_048_576 }, (_, i) => (i * 37 + 19) % 256)
    const crc = new Crc64()
    for (let at = 0; at < bytes.length; at += 10_003) crc.update(bytes.subarray(at, at + 10_003))
    expect(crc.decimal()).toBe('5290352645655371729')
  })
})
