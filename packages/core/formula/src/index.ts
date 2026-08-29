/**
 * The authoring surface, and only that: schema constructors, defineFormula,
 * the context types and the ABI number. What the trusted artifact wrapper
 * needs (decode/encode, the context value, failure recognition) lives at
 * ./runtime — an author's formula imports '@qualy/formula' and nothing else.
 */

export { FORMULA_ABI_VERSION } from './abi.ts'
export type { DecimalArithmetic, FormulaContext } from './context.ts'
export type { Decimal } from './decimal.ts'
export { defineFormula, type FormulaDefinition, type FormulaOutputSchema } from './define.ts'
export {
  SCORE_AMOUNT_SCHEMA,
  Schema,
  type ChoiceOf,
  type DateString,
  type InputOf,
  type Static,
  type StaticInput,
} from './schema.ts'
