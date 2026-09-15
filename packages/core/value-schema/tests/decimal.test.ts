import { it } from '@effect/vitest'
import { Schema } from 'effect'
import { describe, expect } from 'vitest'
import {
  canonicalDecimal,
  compareDecimal,
  fractionalDigits,
  isDecimalString,
  parseDecimal,
} from '../src/decimal.ts'

// The three frozen layers (2026-08-29): lexical syntax, semantic value,
// canonical form. Each case here pins one edge of one layer; a change that
// moves any of them is a contract change, not a refactor.

describe('the lexical layer', () => {
  it.each(['0', '-0', '3', '-3', '3.1', '3.10', '0.5', '-0.001', '10.000'])('admits %s', (value) =>
    expect(isDecimalString(value)).toBe(true),
  )

  it.each(['', '+3', '3.', '.5', '03', '-03', '3e2', '3E2', '1,5', ' 3', '3 ', 'NaN', '0x10'])(
    'refuses %j',
    (value) => {
      expect(isDecimalString(value)).toBe(false)
      expect(parseDecimal(value)).toBeNull()
      expect(canonicalDecimal(value)).toBeNull()
    },
  )
})

describe('the semantic layer', () => {
  it('compares across scales by widening, never by parsing floats', () => {
    expect(compareDecimal(parseDecimal('3.10')!, parseDecimal('3.1')!)).toBe(0)
    expect(compareDecimal(parseDecimal('2.999')!, parseDecimal('3')!)).toBe(-1)
    expect(compareDecimal(parseDecimal('-1.5')!, parseDecimal('-1.50')!)).toBe(0)
    // past every float's precision: differs only in the 20th digit
    expect(
      compareDecimal(
        parseDecimal('0.11111111111111111111')!,
        parseDecimal('0.11111111111111111112')!,
      ),
    ).toBe(-1)
  })

  it('treats negative zero as zero', () => {
    expect(compareDecimal(parseDecimal('-0')!, parseDecimal('0')!)).toBe(0)
    expect(compareDecimal(parseDecimal('-0.00')!, parseDecimal('0')!)).toBe(0)
  })

  it('counts fractional digits after dropping trailing zeros', () => {
    expect(fractionalDigits(parseDecimal('3.1400')!)).toBe(2)
    expect(fractionalDigits(parseDecimal('3.000')!)).toBe(0)
    expect(fractionalDigits(parseDecimal('3')!)).toBe(0)
  })
})

describe('the canonical layer', () => {
  it.each([
    ['3.1400', '3.14'],
    ['5.00', '5'],
    ['0.50', '0.5'],
    ['-0', '0'],
    ['-0.000', '0'],
    ['-2.50', '-2.5'],
    ['0.001', '0.001'],
    ['10.000', '10'],
  ])('canonicalizes %s to %s', (input, expected) => {
    expect(canonicalDecimal(input)).toBe(expected)
  })

  it('is idempotent', () => {
    for (const value of ['3.1400', '-0.000', '10.000', '0.001']) {
      const once = canonicalDecimal(value)!
      expect(canonicalDecimal(once)).toBe(once)
    }
  })
})

// The same three layers, asked about their whole input space rather than
// about nine examples.
//
// These are here because the examples above cannot reach the cases that
// actually broke this module: a scale that differs only past the 17th digit,
// a negative zero at a scale nobody wrote by hand, an integer part long
// enough to leave float range. The generator writes those; the properties
// below say what must hold whatever it writes.

/** a decimal string built out of whatever integers the generator produced */
const decimalOf = (whole: number, fraction: number, scale: number, negative: boolean): string => {
  const places = Math.abs(scale) % 12
  const digits = String(Math.abs(fraction) % 10 ** places).padStart(places, '0')
  const integer = String(Math.abs(whole) % 10 ** 12)
  return `${negative ? '-' : ''}${integer}${places === 0 ? '' : `.${digits}`}`
}

const PARTS = {
  whole: Schema.Int,
  fraction: Schema.Int,
  scale: Schema.Int,
  negative: Schema.Boolean,
}

describe('the three layers, over the whole input space', () => {
  it.prop('writes only strings its own lexical layer admits', PARTS, (parts) =>
    isDecimalString(decimalOf(parts.whole, parts.fraction, parts.scale, parts.negative)),
  )

  it.prop('canonicalizes to a fixed point, still admitted', PARTS, (parts) => {
    const written = decimalOf(parts.whole, parts.fraction, parts.scale, parts.negative)
    const once = canonicalDecimal(written)
    if (once === null) return false
    // admitted, and canonical about itself: a second pass changes nothing
    return isDecimalString(once) && canonicalDecimal(once) === once
  })

  it.prop('canonicalizes without moving the value', PARTS, (parts) => {
    const written = decimalOf(parts.whole, parts.fraction, parts.scale, parts.negative)
    const once = canonicalDecimal(written)!
    return compareDecimal(parseDecimal(written)!, parseDecimal(once)!) === 0
  })

  it.prop('counts the fractional digits the canonical form keeps', PARTS, (parts) => {
    const written = decimalOf(parts.whole, parts.fraction, parts.scale, parts.negative)
    const once = canonicalDecimal(written)!
    const kept = once.includes('.') ? once.split('.')[1]!.length : 0
    return fractionalDigits(parseDecimal(written)!) === kept
  })

  it.prop(
    'orders any two the way their canonical forms compare, in both directions',
    // flat, because the generator takes one schema per name rather than a
    // tree of them
    { ...PARTS, otherWhole: Schema.Int, otherFraction: Schema.Int, otherScale: Schema.Int },
    (parts) => {
      const a = decimalOf(parts.whole, parts.fraction, parts.scale, parts.negative)
      const b = decimalOf(parts.otherWhole, parts.otherFraction, parts.otherScale, !parts.negative)
      const order = compareDecimal(parseDecimal(a)!, parseDecimal(b)!)
      // antisymmetric, and agreeing with the canonical spelling on equality
      return (
        order === -compareDecimal(parseDecimal(b)!, parseDecimal(a)!) &&
        (order === 0) === (canonicalDecimal(a) === canonicalDecimal(b))
      )
    },
  )
})
