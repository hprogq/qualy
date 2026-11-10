// COS uses the reflected ECMA polynomial with complemented initial/final
// state (the same variant as Go's hash/crc64 ECMA). Two 32-bit words avoid
// rounding the checksum and avoid BigInt arithmetic for every byte.
const LOW_POLY = 0xd7870f42
const HIGH_POLY = 0xc96c5795
const table = Array.from({ length: 256 }, (_, byte) => {
  let low = byte
  let high = 0
  for (let bit = 0; bit < 8; bit++) {
    const carry = low & 1
    low = ((low >>> 1) | (high << 31)) ^ (carry ? LOW_POLY : 0)
    high = (high >>> 1) ^ (carry ? HIGH_POLY : 0)
  }
  return [low, high] as const
})

export class Crc64 {
  private low = 0xffffffff
  private high = 0xffffffff

  update(bytes: Uint8Array): void {
    let low = this.low
    let high = this.high
    for (const byte of bytes) {
      const [nextLow, nextHigh] = table[(low ^ byte) & 0xff]!
      low = ((low >>> 8) | (high << 24)) ^ nextLow
      high = (high >>> 8) ^ nextHigh
    }
    this.low = low
    this.high = high
  }

  decimal(): string {
    const high = BigInt((this.high ^ 0xffffffff) >>> 0)
    const low = BigInt((this.low ^ 0xffffffff) >>> 0)
    return ((high << 32n) | low).toString()
  }
}
