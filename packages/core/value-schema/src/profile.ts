/**
 * The schema profile the scoring system speaks: six atomic kinds and a flat
 * input object, all of it a strict subset of JSON Schema 2020-12. The subset
 * is deliberately small so that assignability (does every legal value of A
 * satisfy B?) stays provable — see assignment.ts. Anything outside the
 * profile is rejected here, not interpreted loosely later.
 *
 * `x-qualy-enumLabels` is an annotation: it names choices for people and is
 * excluded from the semantic body, so relabeling never changes a contract
 * hash (canonical.ts).
 */

import { canonicalDecimal, compareDecimal, fractionalDigits, parseDecimal } from './decimal.ts'

export const ENUM_LABELS = 'x-qualy-enumLabels'
export const DECIMAL_FORMAT = 'qualy-decimal'
export const MAX_SCALE = 'x-qualy-maxScale'
export const DECIMAL_MINIMUM = 'x-qualy-minimum'
export const DECIMAL_MAXIMUM = 'x-qualy-maximum'

export interface TextSchema {
  readonly type: 'string'
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
}

export interface IntegerSchema {
  readonly type: 'integer'
  readonly minimum: number
  readonly maximum: number
}

export interface DecimalSchema {
  readonly type: 'string'
  readonly format: typeof DECIMAL_FORMAT
  readonly [MAX_SCALE]: number
  readonly [DECIMAL_MINIMUM]?: string
  readonly [DECIMAL_MAXIMUM]?: string
}

export interface ChoiceSchema {
  readonly type: 'string'
  readonly enum: readonly string[]
  readonly [ENUM_LABELS]?: Readonly<Record<string, string>>
}

export interface BooleanSchema {
  readonly type: 'boolean'
}

export interface DateSchema {
  readonly type: 'string'
  readonly format: 'date'
}

export type AtomicSchema =
  TextSchema | IntegerSchema | DecimalSchema | ChoiceSchema | BooleanSchema | DateSchema

export interface InputSchema {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, AtomicSchema>>
  readonly required: readonly string[]
  readonly additionalProperties: false
}

export type AtomicKind = 'text' | 'integer' | 'decimal' | 'choice' | 'boolean' | 'date'

export interface ProfileIssue {
  readonly path: string
  readonly reason: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** the kind of an already-validated atomic schema */
export const kindOf = (schema: AtomicSchema): AtomicKind => {
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'integer') return 'integer'
  if ('enum' in schema) return 'choice'
  if ('format' in schema) return schema.format === DECIMAL_FORMAT ? 'decimal' : 'date'
  return 'text'
}

const issue = (path: string, reason: string): ProfileIssue => ({ path, reason })

const DATE_SYNTAX = /^(\d{4})-(\d{2})-(\d{2})$/

/** RFC 3339 full-date on the real calendar (leap years included) */
export const isDateString = (value: string): boolean => {
  const match = DATE_SYNTAX.exec(value)
  if (match === null) return false
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  return day <= new Date(Date.UTC(Number(match[1]), month, 0)).getUTCDate()
}

const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string) =>
  Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => issue(path === '' ? key : `${path}.${key}`, 'unknown-key'))

const PARAMETER_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

const atomicIssues = (value: unknown, path: string): readonly ProfileIssue[] => {
  if (!isRecord(value)) return [issue(path, 'not-an-object')]
  const type = value['type']
  if (type === 'boolean') return onlyKeys(value, ['type'], path)
  if (type === 'integer') {
    const found = onlyKeys(value, ['type', 'minimum', 'maximum'], path)
    // every integer carries explicit safe bounds: JSON parsing already loses
    // precision past them, so an unbounded integer schema is not a real domain
    for (const key of ['minimum', 'maximum'] as const) {
      const bound = value[key]
      if (typeof bound !== 'number') found.push(issue(`${path}.${key}`, 'integer-bound-missing'))
      else if (!Number.isSafeInteger(bound))
        found.push(issue(`${path}.${key}`, 'integer-bound-unsafe'))
    }
    const minimum = value['minimum']
    const maximum = value['maximum']
    if (
      typeof minimum === 'number' &&
      typeof maximum === 'number' &&
      Number.isSafeInteger(minimum) &&
      Number.isSafeInteger(maximum) &&
      minimum > maximum
    )
      found.push(issue(path, 'bounds-inverted'))
    return found
  }
  if (type !== 'string') return [issue(`${path}.type`, 'unknown-kind')]

  if ('enum' in value) {
    const found = onlyKeys(value, ['type', 'enum', ENUM_LABELS], path)
    const choices = value['enum']
    if (!Array.isArray(choices) || choices.length === 0) {
      found.push(issue(`${path}.enum`, 'choice-empty'))
      return found
    }
    if (!choices.every((choice) => typeof choice === 'string'))
      found.push(issue(`${path}.enum`, 'choice-not-a-string'))
    else if (new Set(choices).size !== choices.length)
      found.push(issue(`${path}.enum`, 'choice-duplicate'))
    const labels = value[ENUM_LABELS]
    if (labels !== undefined) {
      if (!isRecord(labels)) found.push(issue(`${path}.${ENUM_LABELS}`, 'not-an-object'))
      else {
        for (const [key, label] of Object.entries(labels)) {
          if (!choices.includes(key))
            found.push(issue(`${path}.${ENUM_LABELS}.${key}`, 'label-orphan'))
          if (typeof label !== 'string')
            found.push(issue(`${path}.${ENUM_LABELS}.${key}`, 'label-not-a-string'))
        }
      }
    }
    return found
  }

  const format = value['format']
  if (format === 'date') return onlyKeys(value, ['type', 'format'], path)
  if (format === DECIMAL_FORMAT) {
    const found = onlyKeys(
      value,
      ['type', 'format', MAX_SCALE, DECIMAL_MINIMUM, DECIMAL_MAXIMUM],
      path,
    )
    const maxScale = value[MAX_SCALE]
    if (typeof maxScale !== 'number' || !Number.isInteger(maxScale) || maxScale < 0)
      found.push(issue(`${path}.${MAX_SCALE}`, 'max-scale-invalid'))
    for (const key of [DECIMAL_MINIMUM, DECIMAL_MAXIMUM] as const) {
      const bound = value[key]
      if (bound === undefined) continue
      if (typeof bound !== 'string' || parseDecimal(bound) === null) {
        found.push(issue(`${path}.${key}`, 'decimal-bound-not-lexical'))
        continue
      }
      // a bound more precise than the scale would name a value no instance
      // can take; the contract would be ambiguous about its own edge
      if (typeof maxScale === 'number' && fractionalDigits(parseDecimal(bound)!) > maxScale)
        found.push(issue(`${path}.${key}`, 'decimal-bound-exceeds-scale'))
    }
    const minimum = value[DECIMAL_MINIMUM]
    const maximum = value[DECIMAL_MAXIMUM]
    if (typeof minimum === 'string' && typeof maximum === 'string') {
      const low = parseDecimal(minimum)
      const high = parseDecimal(maximum)
      if (low !== null && high !== null && compareDecimal(low, high) > 0)
        found.push(issue(path, 'bounds-inverted'))
    }
    return found
  }
  if (format !== undefined) return [issue(`${path}.format`, 'unknown-kind')]

  const found = onlyKeys(value, ['type', 'minLength', 'maxLength', 'pattern'], path)
  for (const key of ['minLength', 'maxLength'] as const) {
    const bound = value[key]
    if (bound === undefined) continue
    if (typeof bound !== 'number' || !Number.isInteger(bound) || bound < 0)
      found.push(issue(`${path}.${key}`, 'length-bound-invalid'))
  }
  const minLength = value['minLength']
  const maxLength = value['maxLength']
  if (typeof minLength === 'number' && typeof maxLength === 'number' && minLength > maxLength)
    found.push(issue(path, 'bounds-inverted'))
  const pattern = value['pattern']
  if (pattern !== undefined) {
    if (typeof pattern !== 'string' || pattern === '')
      found.push(issue(`${path}.pattern`, 'pattern-invalid'))
    else {
      try {
        new RegExp(pattern)
      } catch {
        found.push(issue(`${path}.pattern`, 'pattern-invalid'))
      }
    }
  }
  return found
}

/** structural validity of one atomic schema; empty means legal */
export const validateAtomicProfile = (value: unknown): readonly ProfileIssue[] =>
  atomicIssues(value, '')

/** structural validity of a flat input schema; empty means legal */
export const validateInputProfile = (value: unknown): readonly ProfileIssue[] => {
  if (!isRecord(value)) return [issue('', 'not-an-object')]
  const found = onlyKeys(value, ['type', 'properties', 'required', 'additionalProperties'], '')
  if (value['type'] !== 'object') found.push(issue('type', 'unknown-kind'))
  if (value['additionalProperties'] !== false)
    found.push(issue('additionalProperties', 'additional-properties-not-false'))
  const properties = value['properties']
  if (!isRecord(properties)) {
    found.push(issue('properties', 'not-an-object'))
    return found
  }
  for (const [name, property] of Object.entries(properties)) {
    if (!PARAMETER_NAME.test(name))
      found.push(issue(`properties.${name}`, 'parameter-name-invalid'))
    found.push(...atomicIssues(property, `properties.${name}`))
  }
  const required = value['required']
  const names = Object.keys(properties)
  if (
    !Array.isArray(required) ||
    required.length !== names.length ||
    !names.every((name) => required.includes(name))
  )
    found.push(issue('required', 'required-mismatch'))
  return found
}

export const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

const sorted = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) as T

/**
 * A structurally-shared normal form of a legal schema: keys sorted, decimal
 * bounds canonicalized, everything deep-frozen. Callers validate first; this
 * throws on a schema the profile rejected.
 */
export const normalizeAtomicSchema = (schema: AtomicSchema): AtomicSchema => {
  const wrong = validateAtomicProfile(schema)
  if (wrong.length > 0)
    throw new TypeError(`not a profile schema: ${wrong[0]!.path} ${wrong[0]!.reason}`)
  const kind = kindOf(schema)
  if (kind === 'decimal') {
    const decimal = schema as DecimalSchema
    const minimum = decimal[DECIMAL_MINIMUM]
    const maximum = decimal[DECIMAL_MAXIMUM]
    const normalized: DecimalSchema = {
      ...decimal,
      ...(minimum === undefined ? {} : { [DECIMAL_MINIMUM]: canonicalDecimal(minimum)! }),
      ...(maximum === undefined ? {} : { [DECIMAL_MAXIMUM]: canonicalDecimal(maximum)! }),
    }
    return deepFreeze(sorted(normalized))
  }
  if (kind === 'choice') {
    const choice = schema as ChoiceSchema
    const labels = choice[ENUM_LABELS]
    return deepFreeze(
      sorted({
        ...choice,
        enum: [...choice.enum],
        ...(labels === undefined ? {} : { [ENUM_LABELS]: sorted({ ...labels }) }),
      }),
    ) as AtomicSchema
  }
  return deepFreeze(sorted({ ...schema })) as AtomicSchema
}

export const normalizeInputSchema = (schema: InputSchema): InputSchema => {
  const wrong = validateInputProfile(schema)
  if (wrong.length > 0)
    throw new TypeError(`not a profile input: ${wrong[0]!.path} ${wrong[0]!.reason}`)
  const names = Object.keys(schema.properties).sort()
  return deepFreeze({
    type: 'object',
    properties: Object.fromEntries(
      names.map((name) => [name, normalizeAtomicSchema(schema.properties[name]!)]),
    ),
    required: names,
    additionalProperties: false,
  })
}
