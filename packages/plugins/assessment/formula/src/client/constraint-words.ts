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
import type { useI18n } from '@qualy/web-i18n'
import { formulaMessages as m } from './i18n.ts'
import { kindWords } from './kind-words.ts'

// What a parameter will accept, in words.
//
// The same sentences serve the contract table's rule column and the note
// beside a field in the try-run form, so an author reads one wording of the
// same fact wherever they meet it.

type Format = ReturnType<typeof useI18n>['format']

/** the wide space these statements stand apart by, as zh typography sets them */
const GAP = '　'

const bounds = (format: Format, min: string | undefined, max: string | undefined) => {
  if (min !== undefined && max !== undefined) return [format(m.constraintRange, { min, max })]
  if (min !== undefined) return [format(m.constraintAtLeast, { min })]
  if (max !== undefined) return [format(m.constraintAtMost, { max })]
  return []
}

/** what a schema allows, as short separate statements */
export const constraintRules = (
  schema: AtomicSchema,
  format: Format,
  locale: string,
): readonly string[] => {
  switch (kindOf(schema)) {
    case 'integer': {
      const integer = schema as IntegerSchema
      return bounds(format, String(integer.minimum), String(integer.maximum))
    }
    case 'decimal': {
      const decimal = schema as DecimalSchema
      return [
        ...bounds(format, decimal[DECIMAL_MINIMUM], decimal[DECIMAL_MAXIMUM]),
        format(m.constraintScale, { scale: decimal[MAX_SCALE] }),
      ]
    }
    case 'choice': {
      const choice = schema as ChoiceSchema
      return [choice.enum.map((value) => choiceLabel(choice, value, locale)).join(' / ')]
    }
    case 'text': {
      const text = schema as TextSchema
      const length =
        text.minLength !== undefined && text.maxLength !== undefined
          ? [format(m.constraintLength, { min: text.minLength, max: text.maxLength })]
          : text.maxLength !== undefined
            ? [format(m.constraintMaxLength, { max: text.maxLength })]
            : []
      return [
        ...length,
        ...(text.pattern === undefined
          ? []
          : [format(m.constraintPattern, { pattern: text.pattern })]),
      ]
    }
    default:
      return []
  }
}

/** a field's kind and its rules as one line, for the note beside its label */
export const constraintNote = (schema: AtomicSchema, format: Format, locale: string): string =>
  [kindWords(format, kindOf(schema)), ...constraintRules(schema, format, locale)].join(GAP)
