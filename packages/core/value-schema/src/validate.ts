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
  type NormalizedAtomicSchema,
  type NormalizedInputSchema,
} from './profile.ts'
import { compilePattern } from './regex.ts'

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

// the pattern keyword runs on the frozen linear-time engine, never on the
// native backtracking RegExp: what RE2 refuses, the profile already refused
// at configuration time, so compile here cannot fail on a legal schema
const qualyRegExp = Object.assign(
  (pattern: string, _u: string) => {
    const compiled = compilePattern(pattern)
    if (!compiled.ok) throw new Error(`pattern outside the regex profile: ${pattern}`)
    return {
      test: (value: string) => compiled.pattern.test(value),
      // load-bearing, not cosmetic: ajv keys its codegen scope by the
      // engine result's toString() (usePattern: `key: rx.toString()`).
      // A native RegExp stringifies uniquely; a plain object says
      // [object Object] for every pattern, and ajv then reuses the FIRST
      // compiled instance for all of them - measured: the meta-schema's
      // own pattern silently answered for user patterns
      toString: () => `qualy-pattern:${pattern}`,
    }
  },
  { code: 'qualyPattern' },
)

const build = (): Ajv2020 => {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    validateFormats: true,
    code: { regExp: qualyRegExp },
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

// normalized-only on purpose: the cache below keys by object identity and
// assumes the schema can never mutate afterwards, which is exactly what the
// Normalized brand promises (frozen, produced by the normalize factories)
const validatorFor = (schema: NormalizedAtomicSchema | NormalizedInputSchema): ValidateFunction => {
  const known = compiled.get(schema)
  if (known !== undefined) return known
  instance ??= build()
  const validator = instance.compile(schema as object)
  compiled.set(schema, validator)
  return validator
}

const asIssue = (error: ErrorObject): ValueIssue => {
  // a missing or stray property reports at the object, but the property is
  // what a screen has to point at - lift it into the path
  const named =
    (error.params as { missingProperty?: string; additionalProperty?: string } | undefined) ?? {}
  const property = named.missingProperty ?? named.additionalProperty
  return {
    path: property === undefined ? error.instancePath : `${error.instancePath}/${property}`,
    reason: error.keyword,
  }
}

/** judge one value against a normalized profile schema; empty means admitted */
export const validateValue = (
  schema: NormalizedAtomicSchema | NormalizedInputSchema,
  value: unknown,
): readonly ValueIssue[] => {
  const validator = validatorFor(schema)
  return validator(value) ? [] : (validator.errors ?? []).map(asIssue)
}
