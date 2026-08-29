/**
 * The decimal value semantics frozen for scoring contracts (2026-08-29).
 *
 * Three layers, and they never blur:
 *
 * - lexical — `-?(0|[1-9]\d*)(\.\d+)?`: no exponent, no leading zeros (a
 *   single `0` aside), no `+` sign, no empty fraction ("3."). Trailing
 *   zeros ARE accepted on input ("3.10").
 * - semantic — equality, ordering, range and precision are judged on
 *   `{coefficient: bigint, scale}` brought to a common scale; "-0" equals
 *   "0"; floating point never participates.
 * - canonical — the shortest form: trailing zeros dropped, "-0" collapsed
 *   to "0". Storage, wire and hashing use this form.
 *
 * Display (padding a value back out to a declared scale) is a UI concern
 * and does not live in this package.
 */

const LEXICAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

export interface DecimalParts {
  readonly coefficient: bigint
  readonly scale: number
}

export const isDecimalString = (value: string): boolean => LEXICAL.test(value)

export const parseDecimal = (value: string): DecimalParts | null => {
  if (!LEXICAL.test(value)) return null
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const dot = unsigned.indexOf('.')
  const digits = dot === -1 ? unsigned : unsigned.slice(0, dot) + unsigned.slice(dot + 1)
  const magnitude = BigInt(digits)
  return {
    coefficient: negative ? -magnitude : magnitude,
    scale: dot === -1 ? 0 : unsigned.length - dot - 1,
  }
}

export const compareDecimal = (a: DecimalParts, b: DecimalParts): -1 | 0 | 1 => {
  const scale = Math.max(a.scale, b.scale)
  const left = a.coefficient * 10n ** BigInt(scale - a.scale)
  const right = b.coefficient * 10n ** BigInt(scale - b.scale)
  return left < right ? -1 : left > right ? 1 : 0
}

const shortest = (parts: DecimalParts): DecimalParts => {
  let { coefficient, scale } = parts
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n
    scale -= 1
  }
  if (coefficient === 0n) return { coefficient: 0n, scale: 0 }
  return { coefficient, scale }
}

/** semantic fractional digits: the scale once trailing zeros are dropped */
export const fractionalDigits = (parts: DecimalParts): number => shortest(parts).scale

export const renderDecimal = (parts: DecimalParts): string => {
  const { coefficient, scale } = shortest(parts)
  const negative = coefficient < 0n
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0')
  const whole = digits.slice(0, digits.length - scale)
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : ''
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/** the canonical (shortest) form, or null when the input is not lexically a decimal */
export const canonicalDecimal = (value: string): string | null => {
  const parts = parseDecimal(value)
  return parts === null ? null : renderDecimal(parts)
}
