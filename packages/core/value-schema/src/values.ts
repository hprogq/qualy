/**
 * Canonical VALUES, as opposed to canonical schemas.
 *
 * A subpath rather than the package root, for the same reason the score
 * amount is one: the root is what an authored formula's artifact bundles and
 * what the formula workspace typechecks, and neither has any use for host
 * bookkeeping about how a stored value was spelled.
 */

import { canonicalDecimal } from './decimal.ts'
import { kindOf } from './profile.ts'
import type { AtomicSchema } from './profile.ts'

/**
 * One value, spelled the one way its schema says it means.
 *
 * A schema fixes what a value IS; text fixes only how it was typed. For a
 * decimal those come apart: `"3.0"` and `"3.00"` are one number that two
 * people would write differently, and anything that compares or hashes the
 * text - "did this reviewer change the determination", "are these two
 * ballots voting on the same proposal" - would answer no to a question whose
 * honest answer is yes.
 *
 * Only decimals need it today; every other kind in the profile already has
 * exactly one spelling per value. A value the schema does not admit is
 * returned as it came, because canonicalizing is not validating and the
 * validator is the one that gets to refuse.
 */
export const canonicalizeValue = (schema: AtomicSchema, value: unknown): unknown => {
  if (kindOf(schema) !== 'decimal' || typeof value !== 'string') return value
  return canonicalDecimal(value) ?? value
}

/** the same, for a whole determination against the schemas that frame it */
export const canonicalizeValues = (
  schemas: Readonly<Record<string, AtomicSchema>>,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  // canonicalizing is not validating: something that is not an object of
  // values has no canonical form, and it is the validator's job to refuse
  // it - never this function's job to throw on it
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return values as unknown as Record<string, unknown>
  }
  const out: Record<string, unknown> = Object.create(null)
  for (const key of Object.keys(values)) {
    const schema = Object.hasOwn(schemas, key) ? schemas[key] : undefined
    out[key] = schema === undefined ? values[key] : canonicalizeValue(schema, values[key])
  }
  return out
}
