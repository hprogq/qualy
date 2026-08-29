/**
 * What a failed check was actually about, read off the schema itself.
 *
 * A ValueIssue names the keyword that refused ('x-qualy-maximum', 'enum',
 * 'type', ...), which locates the rule but not its content. Screens need the
 * content - the bound, the scale, the admitted choices - and it lives in the
 * schema in hand, so this reads it back out as a display string. Wording is
 * the consumer's business; this only hands over the value.
 */

import {
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  MAX_SCALE,
  kindOf,
  type AtomicSchema,
  type ChoiceSchema,
  type DecimalSchema,
  type InputSchema,
  type IntegerSchema,
  type TextSchema,
} from './profile.ts'
import { canonicalDecimal } from './decimal.ts'

/** the refused rule's own value, rendered for a screen; undefined when the
 * reason carries no bound (a type mismatch answers with the kind instead) */
export const constraintOf = (schema: AtomicSchema, reason: string): string | undefined => {
  switch (reason) {
    case DECIMAL_MAXIMUM:
      return withDecimalBound(schema, DECIMAL_MAXIMUM)
    case DECIMAL_MINIMUM:
      return withDecimalBound(schema, DECIMAL_MINIMUM)
    case MAX_SCALE:
      return numberOn(schema, MAX_SCALE)
    case 'maximum':
      return numberOn(schema, 'maximum' satisfies keyof IntegerSchema)
    case 'minimum':
      return numberOn(schema, 'minimum' satisfies keyof IntegerSchema)
    case 'maxLength':
      return numberOn(schema, 'maxLength' satisfies keyof TextSchema)
    case 'minLength':
      return numberOn(schema, 'minLength' satisfies keyof TextSchema)
    case 'enum':
      return 'enum' in schema ? (schema as ChoiceSchema).enum.join(', ') : undefined
    case 'type':
    case 'format':
      return kindOf(schema)
    case 'pattern':
      // the pattern itself is content the author configured; showing it is
      // the only actionable answer
      return (schema as TextSchema).pattern
    default:
      return undefined
  }
}

const withDecimalBound = (
  schema: AtomicSchema,
  key: typeof DECIMAL_MINIMUM | typeof DECIMAL_MAXIMUM,
): string | undefined => {
  const bound = (schema as DecimalSchema)[key]
  return bound === undefined ? undefined : (canonicalDecimal(bound) ?? bound)
}

const numberOn = (schema: AtomicSchema, key: string): string | undefined => {
  const value = (schema as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' ? String(value) : undefined
}

/** the schema behind one flat-input issue path ('/value' → properties.value) */
export const parameterSchemaAt = (schema: InputSchema, path: string): AtomicSchema | undefined =>
  path.startsWith('/') ? schema.properties[path.slice(1)] : undefined
