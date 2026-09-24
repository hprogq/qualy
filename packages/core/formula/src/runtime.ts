/**
 * The wrapper-facing runtime: representation decode/encode between the JSON
 * the host sends and the typed values a formula body sees. Nothing here
 * validates — the host's ajv is the complete contract validator on both
 * sides of the sandbox, and duplicating a validator into every artifact was
 * ruled out. Decode trusts its input shape; what it cannot represent is a
 * defect, thrown as a plain Error, distinct from FormulaFailure.
 */

import { kindOf, type DecimalSchema, type InputSchema } from '@qualy/value-schema'
import { decimalFromString, decimalToString, type Decimal } from './decimal.ts'

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export { formulaContext, type FormulaContext } from './context.ts'
export { FormulaFailure, isFormulaFailure } from './failure.ts'
export { decimalFromString, decimalToString }

/** JSON input (already host-validated) → the typed values the body receives */
// captured hasOwnProperty, es5-spelled: this module is copied into every
// compiled artifact, whose workspace lib predates Object.hasOwn
const hasOwn = Object.prototype.hasOwnProperty

export const decodeInput = (
  schema: InputSchema,
  value: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, unknown>> => {
  const decoded: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(schema.properties)) {
    // own keys only: the host validated presence, but a parameter may be
    // called `constructor` and this JSON.parse product has a prototype -
    // defense in depth against handing Object.prototype's members to a body
    const given = hasOwn.call(value, name) ? value[name] : undefined
    const decoded_value =
      kindOf(property) === 'decimal' ? decimalFromString(given as string) : given
    if (decoded_value === null && kindOf(property) === 'decimal')
      throw new Error(`decode: ${name} is not a decimal`)
    // defineProperty, not assignment: the profile already refuses __proto__
    // as a parameter name, and this keeps even a slipped-through name from
    // mutating the prototype instead of defining a field
    Object.defineProperty(decoded, name, {
      value: decoded_value,
      enumerable: true,
      writable: false,
      configurable: false,
    })
  }
  return Object.freeze(decoded)
}

const isDecimalValue = (value: unknown): value is Decimal => {
  if (typeof value !== 'object' || value === null) return false
  const shaped = value as { coefficient?: unknown; scale?: unknown }
  return (
    typeof shaped.coefficient === 'bigint' &&
    typeof shaped.scale === 'number' &&
    Number.isSafeInteger(shaped.scale) &&
    shaped.scale >= 0
  )
}

/** the body's return value → the canonical JSON string the host validates */
export const encodeOutput = (_schema: DecimalSchema, value: unknown): string => {
  if (!isDecimalValue(value)) throw new Error('encode: the formula did not return a decimal')
  return decimalToString(value)
}
