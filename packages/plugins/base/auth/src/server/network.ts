import { isIP } from 'node:net'

// The network an address is counted as, by the limits that count addresses.
//
// An IPv4 address is one network exit: a campus, a dormitory block, a home
// router. An IPv6 address is not - one machine is routinely handed a whole
// /64 and may take a new address from it for every request - so an address
// counted on its own is a limit anybody with a /64 steps around by counting
// again from a fresh one. The /64 is what one exit is on IPv6, and that is
// the width the resource fuses and the address risk rules are set for.
//
// Only the address rules read this. What a person typed is never widened: a
// rule on an identifier and a network together would let one person behind
// a campus exit keep another out.

/** the eight groups of an IPv6 address, written out in full */
const groupsOf = (address: string): string[] => {
  let text = address.toLowerCase()
  // a dotted IPv4 tail is the last two groups spelled another way
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (dotted !== null) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number]
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head = '', tail] = text.split('::')
  const front = head === '' ? [] : head.split(':')
  const back = tail === undefined || tail === '' ? [] : tail.split(':')
  const zeros = tail === undefined ? 0 : Math.max(0, 8 - front.length - back.length)
  return [...front, ...Array.from({ length: zeros }, () => '0'), ...back].map((group) =>
    group.padStart(4, '0'),
  )
}

/**
 * The key an address is counted under: an IPv4 address as it is, an IPv6
 * address as its /64. Anything else is returned untouched, so a value this
 * cannot read is still counted - on its own - rather than dropped.
 */
export const networkKeyOf = (address: string): string => {
  const bare = address.split('%')[0]!
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare)
  if (mapped !== null) return mapped[1]!
  if (isIP(bare) !== 6) return address
  return `${groupsOf(bare).slice(0, 4).join(':')}::/64`
}
