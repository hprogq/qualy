/**
 * Instance validation for profile schemas, on ajv (subpath on purpose: the
 * root stays free of the validator bundle; a browser page that only proves
 * assignability never pays for it). Ajv judges VALUES against a schema — the
 * profile's own well-formedness is validateProfile's job, and assignability
 * is assignment.ts's; neither is delegated to ajv.
 *
 * The instance is strict and literal: no coercion, no defaults, no removal.
 * A "3" never becomes 3 on the authoritative path.
 */

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import {
  compareDecimal,
  fractionalDigits,
  isDecimalString,
  parseDecimal,
  type DecimalParts,
} from './decimal.ts'
import {
  DECIMAL_FORMAT,
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  ENUM_LABELS,
  MAX_SCALE,
  isDateString,
  type AtomicSchema,
  type InputSchema,
} from './profile.ts'

export interface ValueIssue {
  /** instance path in JSON Pointer form; '' is the value itself */
  readonly path: string
  /** the failed keyword, e.g. 'type', 'enum', 'x-qualy-maxScale' */
  readonly reason: string
}

// the layering the keywords keep: lexical validity is the format's verdict,
// so a semantic keyword abstains on a value it cannot parse — otherwise every
// bound would pile a second error onto one malformed string
const decimalKeyword = (
  keyword: string,
  holds: (edge: DecimalParts, value: DecimalParts) => boolean,
) =>
  ({
    keyword,
    type: 'string',
    schemaType: 'string',
    compile: (bound: string) => {
      const edge = parseDecimal(bound)
      if (edge === null) throw new TypeError(`${keyword}: bound is not a decimal`)
      return (value: string) => {
        const parts = parseDecimal(value)
        return parts === null || holds(edge, parts)
      }
    },
  }) as const

const build = (): Ajv2020 => {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    validateFormats: true,
  })
  ajv.addFormat('date', { type: 'string', validate: isDateString })
  ajv.addFormat(DECIMAL_FORMAT, { type: 'string', validate: isDecimalString })
  ajv.addKeyword({
    keyword: MAX_SCALE,
    type: 'string',
    schemaType: 'number',
    compile: (maxScale: number) => (value: string) => {
      const parts = parseDecimal(value)
      return parts === null || fractionalDigits(parts) <= maxScale
    },
  })
  ajv.addKeyword(decimalKeyword(DECIMAL_MINIMUM, (edge, value) => compareDecimal(value, edge) >= 0))
  ajv.addKeyword(decimalKeyword(DECIMAL_MAXIMUM, (edge, value) => compareDecimal(value, edge) <= 0))
  // names for people; admits nothing, forbids nothing, hashed by nobody
  ajv.addKeyword({ keyword: ENUM_LABELS, schemaType: 'object' })
  return ajv
}

let instance: Ajv2020 | undefined
const compiled = new WeakMap<object, ValidateFunction>()

const validatorFor = (schema: AtomicSchema | InputSchema): ValidateFunction => {
  const known = compiled.get(schema)
  if (known !== undefined) return known
  instance ??= build()
  const validator = instance.compile(schema as object)
  compiled.set(schema, validator)
  return validator
}

const asIssue = (error: ErrorObject): ValueIssue => ({
  path: error.instancePath,
  reason: error.keyword,
})

/** judge one value against a profile schema; empty means the value is admitted */
export const validateValue = (
  schema: AtomicSchema | InputSchema,
  value: unknown,
): readonly ValueIssue[] => {
  const validator = validatorFor(schema)
  return validator(value) ? [] : (validator.errors ?? []).map(asIssue)
}
