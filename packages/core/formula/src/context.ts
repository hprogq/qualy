/**
 * The `q` a formula body receives: exact decimal arithmetic and a structured
 * refusal. Nothing else — no clock, no randomness, no IO — so the same input
 * can never compute two answers.
 */

import {
  abs,
  add,
  compare,
  fromInteger,
  max,
  min,
  mul,
  mulInteger,
  negate,
  quantize,
  sub,
  type Decimal,
} from './decimal.ts'
import { FormulaFailure } from './failure.ts'

export interface DecimalArithmetic {
  readonly add: (a: Decimal, b: Decimal) => Decimal
  readonly sub: (a: Decimal, b: Decimal) => Decimal
  readonly mul: (a: Decimal, b: Decimal) => Decimal
  readonly mulInteger: (a: Decimal, by: number) => Decimal
  readonly compare: (a: Decimal, b: Decimal) => -1 | 0 | 1
  readonly min: (a: Decimal, b: Decimal) => Decimal
  readonly max: (a: Decimal, b: Decimal) => Decimal
  readonly abs: (a: Decimal) => Decimal
  readonly negate: (a: Decimal) => Decimal
  readonly quantize: (a: Decimal, scale: number) => Decimal
  readonly fromInteger: (value: number) => Decimal
}

export interface FormulaContext {
  readonly decimal: DecimalArithmetic
  readonly fail: (message: string) => never
}

export const formulaContext: FormulaContext = Object.freeze({
  decimal: Object.freeze({
    add,
    sub,
    mul,
    mulInteger,
    compare,
    min,
    max,
    abs,
    negate,
    quantize,
    fromInteger,
  }),
  fail: (message: string): never => {
    throw new FormulaFailure(message)
  },
})
