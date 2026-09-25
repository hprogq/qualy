import { describe, expect, it } from 'vitest'
import { networkKeyOf } from '../src/server/network.ts'

// The key an address is counted under by the limits that count addresses:
// an IPv4 address as itself, an IPv6 address as its /64, however either is
// spelled.

describe('the network an address is counted as', () => {
  it('is an IPv4 address itself', () => {
    expect(networkKeyOf('203.0.113.8')).toBe('203.0.113.8')
    expect(networkKeyOf('203.0.113.9')).toBe('203.0.113.9')
    // the form a socket reports a plain IPv4 peer in
    expect(networkKeyOf('::ffff:203.0.113.8')).toBe('203.0.113.8')
  })

  it('is the /64 of an IPv6 address, however the address is written', () => {
    const one = networkKeyOf('2001:db8:1:2::a')
    expect(one).toBe('2001:0db8:0001:0002::/64')
    for (const same of [
      '2001:db8:1:2:ffff:ffff:ffff:ffff',
      '2001:0DB8:0001:0002:0000:0000:0000:0001',
      '2001:db8:1:2::1.2.3.4',
      '2001:db8:1:2::1%eth0',
    ]) {
      expect(networkKeyOf(same), same).toBe(one)
    }
    expect(networkKeyOf('2001:db8:1:3::a')).not.toBe(one)
    expect(networkKeyOf('::1')).toBe('0000:0000:0000:0000::/64')
    expect(networkKeyOf('2001:db8::')).toBe('2001:0db8:0000:0000::/64')
  })

  it('leaves alone what is not an address, to be counted on its own', () => {
    expect(networkKeyOf('unknown')).toBe('unknown')
  })
})
