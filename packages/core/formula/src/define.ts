import type { DecimalSchema, InputSchema } from '@qualy/value-schema'
import type { FormulaContext } from './context.ts'
import type { Static, StaticInput } from './schema.ts'

/** the first version scores with decimals only; the output contract says so */
export type FormulaOutputSchema = DecimalSchema

export interface FormulaDefinition<
  I extends InputSchema = InputSchema,
  O extends FormulaOutputSchema = FormulaOutputSchema,
> {
  readonly input: I
  readonly output: O
  readonly run: (input: StaticInput<I>, q: FormulaContext) => Static<O>
}

/**
 * The whole authoring surface: input contract, output contract, and a body
 * whose types are derived from them — there is no separate Input interface
 * to keep in sync. The definition is frozen; the contracts inside it came
 * frozen from the constructors.
 */
export const defineFormula = <const I extends InputSchema, const O extends FormulaOutputSchema>(
  definition: FormulaDefinition<I, O>,
): FormulaDefinition<I, O> => Object.freeze(definition)
