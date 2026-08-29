/**
 * The assignability prover: may a value produced under `source` flow into a
 * slot declared as `target`? The answer is about EVERY legal source value,
 * never about the values currently stored — a binding is safe or it is not
 * configurable at all.
 *
 * Verdicts are conservative by design. Where a proof would need more theory
 * than the profile is worth (regex language inclusion, cross-kind coercion),
 * the answer is `incompatible`, not "probably fine". The only cross-kind
 * plan is integer → decimal, and even that must show the whole integer
 * domain fits the decimal bounds.
 */

import { compareDecimal, parseDecimal, type DecimalParts } from './decimal.ts'
import { INTEGER_TO_DECIMAL, type ConverterRef } from './convert.ts'
import {
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  MAX_SCALE,
  kindOf,
  type AtomicSchema,
  type ChoiceSchema,
  type DecimalSchema,
  type IntegerSchema,
  type TextSchema,
} from './profile.ts'

export type AssignmentPlan =
  | { readonly kind: 'direct' }
  | { readonly kind: 'convert'; readonly converter: ConverterRef }
  | { readonly kind: 'incompatible'; readonly code: string; readonly detail?: unknown }

const direct: AssignmentPlan = { kind: 'direct' }

const refused = (code: string, detail?: unknown): AssignmentPlan =>
  detail === undefined ? { kind: 'incompatible', code } : { kind: 'incompatible', code, detail }

const decimalBound = (bound: string | undefined): DecimalParts | null =>
  bound === undefined ? null : parseDecimal(bound)

/** [min, max] of a decimal schema, null meaning unbounded on that side */
const decimalRange = (schema: DecimalSchema) =>
  ({
    low: decimalBound(schema[DECIMAL_MINIMUM]),
    high: decimalBound(schema[DECIMAL_MAXIMUM]),
  }) as const

const withinDecimal = (
  low: DecimalParts | null,
  high: DecimalParts | null,
  target: DecimalSchema,
): boolean => {
  const bounds = decimalRange(target)
  // an unbounded source side can only flow into an unbounded target side
  if (bounds.low !== null && (low === null || compareDecimal(low, bounds.low) < 0)) return false
  if (bounds.high !== null && (high === null || compareDecimal(high, bounds.high) > 0)) return false
  return true
}

const textPlan = (source: TextSchema, target: TextSchema): AssignmentPlan => {
  const sourceMin = source.minLength ?? 0
  const targetMin = target.minLength ?? 0
  if (sourceMin < targetMin) return refused('text-length-widens', { side: 'minLength' })
  if (
    target.maxLength !== undefined &&
    (source.maxLength === undefined || source.maxLength > target.maxLength)
  )
    return refused('text-length-widens', { side: 'maxLength' })
  // pattern inclusion is undecidable at the price we are willing to pay:
  // provable only when the target asks nothing, or asks the same words
  if (target.pattern !== undefined && source.pattern !== target.pattern)
    return refused('pattern-unprovable')
  return direct
}

const integerPlan = (source: IntegerSchema, target: IntegerSchema): AssignmentPlan =>
  source.minimum >= target.minimum && source.maximum <= target.maximum
    ? direct
    : refused('integer-range-widens')

const decimalPlan = (source: DecimalSchema, target: DecimalSchema): AssignmentPlan => {
  if (source[MAX_SCALE] > target[MAX_SCALE]) return refused('decimal-scale-widens')
  const range = decimalRange(source)
  return withinDecimal(range.low, range.high, target) ? direct : refused('decimal-range-widens')
}

const choicePlan = (source: ChoiceSchema, target: ChoiceSchema): AssignmentPlan => {
  const admitted = new Set(target.enum)
  const extra = source.enum.filter((choice) => !admitted.has(choice))
  return extra.length === 0 ? direct : refused('choice-widens', { extra })
}

const integerIntoDecimal = (source: IntegerSchema, target: DecimalSchema): AssignmentPlan => {
  const low: DecimalParts = { coefficient: BigInt(source.minimum), scale: 0 }
  const high: DecimalParts = { coefficient: BigInt(source.maximum), scale: 0 }
  return withinDecimal(low, high, target)
    ? { kind: 'convert', converter: INTEGER_TO_DECIMAL }
    : refused('converter-domain-exceeds')
}

export const assignmentPlan = (source: AtomicSchema, target: AtomicSchema): AssignmentPlan => {
  const from = kindOf(source)
  const to = kindOf(target)
  if (from === 'integer' && to === 'decimal')
    return integerIntoDecimal(source as IntegerSchema, target as DecimalSchema)
  if (from !== to) return refused('kind-mismatch', { from, to })
  switch (from) {
    case 'text':
      return textPlan(source as TextSchema, target as TextSchema)
    case 'integer':
      return integerPlan(source as IntegerSchema, target as IntegerSchema)
    case 'decimal':
      return decimalPlan(source as DecimalSchema, target as DecimalSchema)
    case 'choice':
      return choicePlan(source as ChoiceSchema, target as ChoiceSchema)
    case 'boolean':
    case 'date':
      return direct
  }
}
