import {
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  MAX_SCALE,
  choiceLabel,
  kindOf,
  type AtomicSchema,
  type ChoiceSchema,
  type DecimalSchema,
  type IntegerSchema,
  type TextSchema,
} from '@qualy/value-schema'

import { kindWords } from './kind-words.ts'
import * as m from '#messages'

// What a parameter will accept, in words.
//
// The same sentences serve the contract table's rule column and the note
// beside a field in the try-run form, so an author reads one wording of the
// same fact wherever they meet it.

/** the wide space these statements stand apart by, as zh typography sets them */
const GAP = '　'

const bounds = (min: string | undefined, max: string | undefined) => {
  if (min !== undefined && max !== undefined) return [m.constraint_range({ min, max })]
  if (min !== undefined) return [m.constraint_atLeast({ min })]
  if (max !== undefined) return [m.constraint_atMost({ max })]
  return []
}

/** what a schema allows, as short separate statements */
export const constraintRules = (
  schema: AtomicSchema,
  locale: string,
  /**
   * Name a pattern instead of printing it.
   *
   * A pattern is the one rule that cannot be read at a glance:
   * `^[A-Z]{2}-[0-9]{4}$` beside a field is forty characters of punctuation
   * that answers "what goes in here" with another question. Beside the box
   * it is named; in the contract table, where an author is reading the
   * contract itself, it is printed in full.
   */
  brief = false,
): readonly string[] => {
  switch (kindOf(schema)) {
    case 'integer': {
      const integer = schema as IntegerSchema
      return bounds(String(integer.minimum), String(integer.maximum))
    }
    case 'decimal': {
      const decimal = schema as DecimalSchema
      return [
        ...bounds(decimal[DECIMAL_MINIMUM], decimal[DECIMAL_MAXIMUM]),
        m.constraint_scale({ scale: decimal[MAX_SCALE] }),
      ]
    }
    case 'choice': {
      const choice = schema as ChoiceSchema
      return [choice.enum.map((value) => choiceLabel(choice, value, locale)).join(' / ')]
    }
    case 'boolean':
      // it takes two values and only two; "anything" was the default answer
      // for a kind with no bounds to state, which reads as no rule at all
      return [m.constraint_boolean()]
    case 'text': {
      const text = schema as TextSchema
      const length =
        text.minLength !== undefined && text.maxLength !== undefined
          ? [m.constraint_length({ min: text.minLength, max: text.maxLength })]
          : text.maxLength !== undefined
            ? [m.constraint_maxLength({ max: text.maxLength })]
            : []
      return [
        ...length,
        ...(text.pattern === undefined
          ? []
          : [brief ? m.constraint_patterned() : m.constraint_pattern({ pattern: text.pattern })]),
      ]
    }
    default:
      return []
  }
}

/** a field's kind and its rules as one line, for the note beside its label */
export const constraintNote = (schema: AtomicSchema, locale: string): string =>
  [kindWords(kindOf(schema)), ...constraintRules(schema, locale, true)].join(GAP)
