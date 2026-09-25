/**
 * Instance validation for profile schemas, by interpretation.
 *
 * The profile is six atomic kinds and one object of them (profile.ts), so
 * a value is judged by walking the schema, not by compiling it: ajv turns
 * every schema into JavaScript source and runs it through `Function`,
 * which the browser's content security policy names as unsafe-eval, and
 * the one place a page needs this - the value form checking what was
 * typed - is the one place a policy is enforced. ajv keeps its place as
 * the oracle in the tests: every verdict here is held equal to draft
 * 2020-12's on the profile, keyword names, paths and order included.
 *
 * The instance is strict and literal: no coercion, no defaults, no removal.
 * A "3" never becomes 3 on the authoritative path. Objects are read by own
 * property only, so a name that spells a prototype member is neither
 * present nor a value.
 */

import {
  compareDecimal,
  fractionalDigits,
  isDecimalString,
  parseDecimal,
  type DecimalParts,
} from './decimal.ts'
import {
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  MAX_SCALE,
  isDateString,
  DATE_MINIMUM,
  DATE_MAXIMUM,
  type AtomicSchema,
  type NormalizedAtomicSchema,
  type NormalizedInputSchema,
} from './profile.ts'
import { PatternCache } from './pattern-cache.ts'

export interface ValueIssue {
  /** instance path in JSON Pointer form; '' is the value itself */
  readonly path: string
  /** the failed keyword, e.g. 'type', 'enum', 'x-qualy-maxScale' */
  readonly reason: string
}

const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

// the pattern keyword runs on the frozen linear-time engine, never on the
// native backtracking RegExp: what RE2 refuses, the profile already refused
// at configuration time, so compiling here cannot fail on a legal schema.
// Compiled once per pattern text and kept, within a weight budget: the
// patterns are whatever somebody wrote into a contract, and one of them can
// weigh megabytes. A few dozen megabytes held at most.
const PATTERN_CACHE_WEIGHT = 2_000_000
const patterns = new PatternCache(PATTERN_CACHE_WEIGHT)
const patternFor = (pattern: string) => patterns.get(pattern)

// the layering the keywords keep: lexical validity is the format's verdict,
// so a semantic keyword abstains on a value it cannot parse - otherwise every
// bound would pile a second error onto one malformed string
const decimalBound = (
  edge: string | undefined,
  value: DecimalParts | null,
  holds: (edge: DecimalParts, value: DecimalParts) => boolean,
): boolean => {
  if (edge === undefined || value === null) return true
  const parsed = parseDecimal(edge)
  if (parsed === null) throw new TypeError('bound is not a decimal')
  return holds(parsed, value)
}

/**
 * One atomic value. The keywords are judged in the order draft 2020-12
 * writes them, and a type that does not fit ends the judgement: nothing
 * else applies to a value of the wrong type.
 */
const atomicIssues = (schema: AtomicSchema, value: unknown, path: string): ValueIssue[] => {
  const issues: ValueIssue[] = []
  const failed = (reason: string) => issues.push({ path, reason })
  switch (schema.type) {
    case 'boolean':
      if (typeof value !== 'boolean') failed('type')
      return issues
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        failed('type')
        return issues
      }
      if (value < schema.minimum) failed('minimum')
      if (value > schema.maximum) failed('maximum')
      return issues
    case 'string': {
      if (typeof value !== 'string') {
        failed('type')
        // enum is not a string keyword: it judges a value of any type, so a
        // wrong-typed value fails it too, as the draft has it
        if ('enum' in schema && !schema.enum.includes(value as never)) failed('enum')
        return issues
      }
      if ('enum' in schema) {
        if (!schema.enum.includes(value)) failed('enum')
        return issues
      }
      if ('format' in schema) {
        if (schema.format === 'date') {
          if (!isDateString(value)) failed('format')
          // the window the question drew; the round's own material period is
          // the host's to apply, because only the host knows the round
          else if (schema[DATE_MINIMUM] !== undefined && value < schema[DATE_MINIMUM]) {
            failed(DATE_MINIMUM)
          } else if (schema[DATE_MAXIMUM] !== undefined && value > schema[DATE_MAXIMUM]) {
            failed(DATE_MAXIMUM)
          }
          return issues
        }
        // a decimal: the format speaks first, the bounds only on what parses
        if (!isDecimalString(value)) failed('format')
        const parts = parseDecimal(value)
        if (parts !== null && fractionalDigits(parts) > schema[MAX_SCALE]) failed(MAX_SCALE)
        if (
          !decimalBound(
            schema[DECIMAL_MINIMUM],
            parts,
            (edge, given) => compareDecimal(given, edge) >= 0,
          )
        ) {
          failed(DECIMAL_MINIMUM)
        }
        if (
          !decimalBound(
            schema[DECIMAL_MAXIMUM],
            parts,
            (edge, given) => compareDecimal(given, edge) <= 0,
          )
        ) {
          failed(DECIMAL_MAXIMUM)
        }
        return issues
      }
      // text: the string's own length in code points, as the draft counts
      const length =
        schema.minLength === undefined && schema.maxLength === undefined ? 0 : [...value].length
      if (schema.minLength !== undefined && length < schema.minLength) failed('minLength')
      if (schema.maxLength !== undefined && length > schema.maxLength) failed('maxLength')
      if (schema.pattern !== undefined && !patternFor(schema.pattern).test(value)) failed('pattern')
      return issues
    }
  }
}

/**
 * An input object: its own properties against the parameter schemas, each
 * required name present, nothing beyond the declared names. A missing or a
 * stray property reports at the property, which is what a screen has to
 * point at.
 */
const inputIssues = (schema: NormalizedInputSchema, value: unknown): ValueIssue[] => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path: '', reason: 'type' }]
  }
  const issues: ValueIssue[] = []
  for (const name of schema.required) {
    if (!has(value, name)) issues.push({ path: `/${name}`, reason: 'required' })
  }
  for (const name of Object.keys(value)) {
    if (!has(schema.properties, name)) {
      issues.push({ path: `/${name}`, reason: 'additionalProperties' })
      continue
    }
    issues.push(
      ...atomicIssues(
        schema.properties[name]!,
        (value as Record<string, unknown>)[name],
        `/${name}`,
      ),
    )
  }
  return issues
}

/** judge one value against a normalized profile schema; empty means admitted */
export const validateValue = (
  schema: NormalizedAtomicSchema | NormalizedInputSchema,
  value: unknown,
): readonly ValueIssue[] =>
  schema.type === 'object' ? inputIssues(schema, value) : atomicIssues(schema, value, '')
