/**
 * The frozen regex engine behind the profile's `pattern` keyword.
 *
 * Persisted schemas keep the standard JSON Schema `pattern` word, but its
 * meaning here is the Qualy Regex Profile: RE2-compatible syntax, matched in
 * linear time by re2js, identically in Node and the browser. Backreferences
 * and look-around are refused at CONFIGURATION time - they are what a
 * backtracking engine needs and a linear one deliberately lacks - so a
 * catastrophic pattern can never reach the host validator at all. There is
 * no fallback to the native RegExp: what RE2 refuses, the profile does not
 * support.
 *
 * The engine is part of the scoring-contract interpreter; the profile
 * version below is frozen into published formula versions so a future
 * engine or syntax change cannot silently reinterpret history.
 */

import { RE2JS } from 're2js'
import type { AtomicSchema, InputSchema, ProfileIssue } from './profile.ts'

export const REGEX_PROFILE_VERSION = 1

export const MAX_PATTERN_BYTES = 1024

/**
 * Linear time bounds the exponent, not the constant: a pattern's compiled
 * program still costs memory and per-character work proportional to its
 * size. Measured while wiring this up: everyday anchored shapes like
 * `^[A-Z][0-9]{6}$` compile to a few dozen instructions, so this ceiling is
 * two orders above any legitimate scoring constraint.
 */
export const MAX_PATTERN_PROGRAM_SIZE = 2000

export interface QualyPattern {
  readonly source: string
  readonly programSize: number
  readonly test: (value: string) => boolean
}

export type PatternRefusal = 'pattern-invalid' | 'pattern-too-large' | 'pattern-too-complex'

export type CompiledPattern =
  | { readonly ok: true; readonly pattern: QualyPattern }
  | { readonly ok: false; readonly reason: PatternRefusal }

// arithmetic only: TextEncoder is a platform global outside the ES2020 lib
// this file is typechecked against inside a formula workspace
const utf8Length = (value: string): number => {
  let bytes = 0
  for (const character of value) {
    const point = character.codePointAt(0)!
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4
  }
  return bytes
}

export const compilePattern = (source: string): CompiledPattern => {
  if (source === '') return { ok: false, reason: 'pattern-invalid' }
  if (utf8Length(source) > MAX_PATTERN_BYTES) return { ok: false, reason: 'pattern-too-large' }
  let compiled: RE2JS
  try {
    // no flags on purpose: the profile is one fixed dialect
    compiled = RE2JS.compile(source)
  } catch {
    return { ok: false, reason: 'pattern-invalid' }
  }
  const programSize = compiled.programSize()
  if (programSize > MAX_PATTERN_PROGRAM_SIZE) return { ok: false, reason: 'pattern-too-complex' }
  return {
    ok: true,
    pattern: {
      source,
      programSize,
      // re2js `test` is the unanchored search JSON Schema's keyword means
      test: (value: string) => compiled.test(value),
    },
  }
}

/**
 * The regex-profile half of schema validation, split from validateProfile so
 * the engine stays out of formula artifacts: every host entry that accepts a
 * schema (publication, binding screens) runs this beside the structural
 * check; a guest never needs to.
 */
export const patternIssues = (
  schema: AtomicSchema | InputSchema,
  path = '',
): readonly ProfileIssue[] => {
  if ('properties' in schema)
    return Object.entries(schema.properties).flatMap(([name, property]) =>
      patternIssues(property, `properties.${name}`),
    )
  const pattern = (schema as { pattern?: unknown }).pattern
  if (pattern === undefined || typeof pattern !== 'string') return []
  const compiled = compilePattern(pattern)
  return compiled.ok
    ? []
    : [{ path: path === '' ? 'pattern' : `${path}.pattern`, reason: compiled.reason }]
}
