/**
 * The semantic body of a schema and its canonical bytes.
 *
 * Two schemas mean the same contract exactly when their canonical bytes are
 * equal: keys are ordered, decimal bounds reduced to canonical form, and
 * annotations (`x-qualy-enumLabels`) stripped — relabeling a choice for
 * people never changes what values the contract admits, so it must never
 * change a hash. Hashing itself lives in ./hash (node:crypto); this module
 * stays runnable in a browser.
 */

import { canonicalDecimal } from './decimal.ts'
import {
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  ENUM_LABELS,
  kindOf,
  type AtomicSchema,
  type DecimalSchema,
  type InputSchema,
} from './profile.ts'

const ordered = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))

/**
 * The annotation-free, canonically-bounded body of one atomic schema.
 *
 * Two schemas admit the same values exactly when their bodies are equal, so
 * everything that does not move the admitted set is normalized away here:
 * labels are dropped, choice order is sorted (["a","b"] and ["b","a"] admit
 * identically), a minLength of 0 says nothing and is omitted, and integer
 * bounds that merely restate the implicit safe range are omitted too. The
 * stored schema keeps its authored shape - option order stays meaningful
 * for screens - only the semantic identity is order-free.
 */
export const semanticBodyOfAtomic = (schema: AtomicSchema): Record<string, unknown> => {
  const kind = kindOf(schema)
  if (kind === 'integer') {
    const body: Record<string, unknown> = { ...schema }
    if (body['minimum'] === Number.MIN_SAFE_INTEGER) delete body['minimum']
    if (body['maximum'] === Number.MAX_SAFE_INTEGER) delete body['maximum']
    return ordered(body)
  }
  if (kind === 'text') {
    const body: Record<string, unknown> = { ...schema }
    if (body['minLength'] === 0) delete body['minLength']
    return ordered(body)
  }
  if (kind === 'decimal') {
    const decimal = schema as DecimalSchema
    const body: Record<string, unknown> = { ...decimal }
    for (const key of [DECIMAL_MINIMUM, DECIMAL_MAXIMUM] as const) {
      const bound = decimal[key]
      if (bound !== undefined) body[key] = canonicalDecimal(bound)
    }
    return ordered(body)
  }
  if (kind === 'choice') {
    const body: Record<string, unknown> = { ...schema }
    delete body[ENUM_LABELS]
    body['enum'] = [...(schema as { enum: readonly string[] }).enum].sort()
    return ordered(body)
  }
  return ordered({ ...schema })
}

export const semanticBodyOfInput = (schema: InputSchema): Record<string, unknown> => {
  const names = Object.keys(schema.properties).sort()
  return {
    additionalProperties: false,
    properties: Object.fromEntries(
      names.map((name) => [name, semanticBodyOfAtomic(schema.properties[name]!)]),
    ),
    required: names,
    type: 'object',
  }
}

export const canonicalizeAtomicSchema = (schema: AtomicSchema): string =>
  JSON.stringify(semanticBodyOfAtomic(schema))

export const canonicalizeInputSchema = (schema: InputSchema): string =>
  JSON.stringify(semanticBodyOfInput(schema))
