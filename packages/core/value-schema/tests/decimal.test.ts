import { describe, expect, it } from 'vitest'
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
