/**
 * The opaque Decimal a formula computes with. Statically it exposes nothing;
 * at runtime it is a frozen {coefficient, scale} pair the context's
 * arithmetic understands. Intermediate results carry whatever scale the
 * arithmetic produces — nothing rounds silently; narrowing is only ever the
 * author's explicit `quantize`.
 *
 * Every operation is bigint decimal arithmetic (ES2020, QuickJS included);
 * IEEE-754 never participates.
 */

import { parseDecimal, renderDecimal } from '@qualy/value-schema'
import { FormulaFailure } from './failure.ts'

declare const DecimalType: unique symbol

/** a decimal value; construct via the context or the runtime decoder only */
export interface Decimal {
  readonly [DecimalType]: 'decimal'
}

interface Parts {
  readonly coefficient: bigint
  readonly scale: number
}

const make = (coefficient: bigint, scale: number): Decimal =>
  Object.freeze({ coefficient, scale }) as unknown as Decimal

const parts = (value: Decimal): Parts => value as unknown as Parts

const aligned = (a: Decimal, b: Decimal): readonly [bigint, bigint, number] => {
  const left = parts(a)
  const right = parts(b)
  const scale = Math.max(left.scale, right.scale)
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  ]
}

export const decimalFromString = (value: string): Decimal | null => {
  const parsed = parseDecimal(value)
  return parsed === null ? null : make(parsed.coefficient, parsed.scale)
}

export const decimalToString = (value: Decimal): string => renderDecimal(parts(value))

const wholeNumber = (value: number, what: string): bigint => {
  if (!Number.isSafeInteger(value)) throw new FormulaFailure(`${what}: not a safe integer`)
  return BigInt(value)
}

export const add = (a: Decimal, b: Decimal): Decimal => {
  const [left, right, scale] = aligned(a, b)
  return make(left + right, scale)
}

export const sub = (a: Decimal, b: Decimal): Decimal => {
  const [left, right, scale] = aligned(a, b)
  return make(left - right, scale)
}

export const mul = (a: Decimal, b: Decimal): Decimal => {
  const left = parts(a)
  const right = parts(b)
  return make(left.coefficient * right.coefficient, left.scale + right.scale)
}

export const mulInteger = (a: Decimal, by: number): Decimal => {
  const left = parts(a)
  return make(left.coefficient * wholeNumber(by, 'mulInteger'), left.scale)
}

export const compare = (a: Decimal, b: Decimal): -1 | 0 | 1 => {
  const [left, right] = aligned(a, b)
  return left < right ? -1 : left > right ? 1 : 0
}

export const min = (a: Decimal, b: Decimal): Decimal => (compare(a, b) <= 0 ? a : b)

export const max = (a: Decimal, b: Decimal): Decimal => (compare(a, b) >= 0 ? a : b)

export const abs = (a: Decimal): Decimal => {
  const value = parts(a)
  return value.coefficient < 0n ? make(-value.coefficient, value.scale) : a
}

export const negate = (a: Decimal): Decimal => {
  const value = parts(a)
  return make(-value.coefficient, value.scale)
}

/** re-scale explicitly; narrowing rounds half away from zero, the ledger's rule */
export const quantize = (a: Decimal, scale: number): Decimal => {
  if (!Number.isSafeInteger(scale) || scale < 0) throw new FormulaFailure('quantize: not a scale')
  const value = parts(a)
  if (scale >= value.scale)
    return make(value.coefficient * 10n ** BigInt(scale - value.scale), scale)
  const factor = 10n ** BigInt(value.scale - scale)
  const quotient = value.coefficient / factor
  const remainder = value.coefficient % factor
  const magnitude = remainder < 0n ? -remainder : remainder
  if (magnitude * 2n < factor) return make(quotient, scale)
  return make(quotient + (value.coefficient < 0n ? -1n : 1n), scale)
}

export const fromInteger = (value: number): Decimal => make(wholeNumber(value, 'fromInteger'), 0)
