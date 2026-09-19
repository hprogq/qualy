import {
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  MAX_SCALE,
  choiceLabel,
  displayTitle,
  kindOf,
} from '@qualy/value-schema'
import type { AtomicSchema, ChoiceSchema } from '@qualy/value-schema'
import type { FieldDraft } from './FieldTable.tsx'

// A filing field made to answer one calculator parameter.
//
// A question is composed by naming the arithmetic first: its parameters are
// what the form is then built out of. So when somebody says a parameter is
// prefilled from the filing, the field that prefills it is made here rather
// than left for them to guess at - the type, the bounds and the choices all
// come from what the parameter takes, so the field is assignable into it by
// construction rather than by luck.
//
// WHAT CANNOT BE MADE IS SAID SO. The filing form has no yes-or-no field,
// and no way to state a pattern or a shortest length. A parameter asking for
// any of those gets `null` here, and the editor does not offer prefilling at
// all - rather than quietly making a wider field and letting the save refuse
// it, which is the same refusal a hundred rows later.
//
// The bounds are the parameter's OWN. Narrowing them afterwards is the
// author's to do and is judged by the same assignability proof as any other
// binding; what this must never do is start wider than the parameter, which
// would make its first save illegal.

/** whether a filing field can express what this parameter takes */
export const prefillable = (schema: AtomicSchema): boolean => {
  const kind = kindOf(schema)
  if (kind === 'boolean') return false
  if (kind === 'text') {
    const text = schema as { pattern?: unknown; minLength?: unknown }
    // neither can be stated on a filing field, so neither can be proved
    return text.pattern === undefined && text.minLength === undefined
  }
  return kind === 'integer' || kind === 'decimal' || kind === 'choice' || kind === 'date'
}

const said = (value: unknown): string => (value === undefined || value === null ? '' : String(value))

/**
 * The field, named after the parameter and shaped by it.
 *
 * `key` and `id` are the caller's to mint - they are the form's own identity
 * scheme, and this module has no business inventing one.
 */
export const prefillField = (
  schema: AtomicSchema,
  parameter: string,
  locale: string,
  key: string,
): FieldDraft | null => {
  if (!prefillable(schema)) return null
  const base = { id: key, key, label: displayTitle(schema, parameter, locale), required: true }
  const bounds = schema as {
    minimum?: unknown
    maximum?: unknown
    maxLength?: unknown
    [MAX_SCALE]?: unknown
    [DECIMAL_MINIMUM]?: unknown
    [DECIMAL_MAXIMUM]?: unknown
  }
  switch (kindOf(schema)) {
    case 'text':
      return { ...base, type: 'text', maxLength: said(bounds.maxLength) }
    case 'date':
      return { ...base, type: 'date', min: '', max: '' }
    case 'integer':
      return { ...base, type: 'integer', min: said(bounds.minimum), max: said(bounds.maximum) }
    case 'decimal':
      return {
        ...base,
        type: 'decimal',
        maxScale: said(bounds[MAX_SCALE]) === '' ? '2' : said(bounds[MAX_SCALE]),
        // a decimal's bounds are spelled as annotations, never as `minimum`
        // and `maximum` - those belong to integers. Read from the wrong keys
        // the field came out unbounded, which is a field the very parameter
        // it was made for will not accept.
        min: said(bounds[DECIMAL_MINIMUM]),
        max: said(bounds[DECIMAL_MAXIMUM]),
      }
    case 'choice': {
      const choice = schema as ChoiceSchema
      return {
        ...base,
        type: 'choice',
        options: choice.enum.map((value) => ({
          value,
          label: choiceLabel(choice, value, locale),
        })),
      }
    }
    default:
      return null
  }
}
