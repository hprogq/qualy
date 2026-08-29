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
export const decodeInput = (
  schema: InputSchema,
  value: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, unknown>> => {
  const decoded: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(schema.properties)) {
    const given = value[name]
    if (kindOf(property) === 'decimal') {
      const parsed = decimalFromString(given as string)
      if (parsed === null) throw new Error(`decode: ${name} is not a decimal`)
      decoded[name] = parsed
    } else {
      decoded[name] = given
    }
  }
  return Object.freeze(decoded)
}

const isDecimalValue = (value: unknown): value is Decimal =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { coefficient?: unknown }).coefficient === 'bigint' &&
  typeof (value as { scale?: unknown }).scale === 'number'

/** the body's return value → the canonical JSON string the host validates */
export const encodeOutput = (_schema: DecimalSchema, value: unknown): string => {
  if (!isDecimalValue(value)) throw new Error('encode: the formula did not return a decimal')
  return decimalToString(value)
}
