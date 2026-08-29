/**
 * The schema profile the scoring system speaks: six atomic kinds and a flat
 * input object, all of it a strict subset of JSON Schema 2020-12. The subset
 * is deliberately small so that assignability (does every legal value of A
 * satisfy B?) stays provable — see assignment.ts. Anything outside the
 * profile is rejected here, not interpreted loosely later.
 *
 * Annotations name things for people and are excluded from the semantic
 * body, so relabeling never changes a contract hash (canonical.ts). v2 makes
 * that a layer rather than one carve-out: `title`, `description` and
 * `x-qualy-i18n` may sit on any atomic schema, `x-qualy-order` on the input
 * object, and `x-qualy-enumLabels` stays the choice labels - none of them
 * participate in validation, assignability or hashing.
 */

import { canonicalDecimal, compareDecimal, fractionalDigits, parseDecimal } from './decimal.ts'

/**
 * The profile's own version: the number a frozen contract records so a later
 * change to what this language admits cannot silently reinterpret it.
 */
export const VALUE_SCHEMA_PROFILE_VERSION = 2

/**
 * The language's hard ceilings - a definition, not a UI nicety. Everything a
 * schema admits costs compilation, canonicalization, validation and screen
 * space downstream; v1 draws the lines wide enough for every real scoring
 * contract and refuses the rest until a business case raises the profile
 * version.
 */
export const PROFILE_LIMITS = Object.freeze({
  inputParameters: 64,
  parameterNameLength: 64,
  choiceOptions: 256,
  choiceValueLength: 128,
  choiceLabelLength: 255,
  textLengthBound: 10_000,
  decimalMaxScale: 18,
  annotationTitleLength: 255,
  annotationDescriptionLength: 2_000,
  annotationLocales: 8,
})

export const ENUM_LABELS = 'x-qualy-enumLabels'
export const I18N = 'x-qualy-i18n'
export const INPUT_ORDER = 'x-qualy-order'
export const DECIMAL_FORMAT = 'qualy-decimal'
export const MAX_SCALE = 'x-qualy-maxScale'
export const DECIMAL_MINIMUM = 'x-qualy-minimum'
export const DECIMAL_MAXIMUM = 'x-qualy-maximum'

/** one locale's worth of people-facing words for a schema */
export interface SchemaI18nEntry {
  readonly title?: string
  readonly description?: string
  /** choice only: per-value labels in this locale */
  readonly enumLabels?: Readonly<Record<string, string>>
}

/**
 * The people-facing layer any schema may carry. Validation, assignability
 * and hashing never read these; screens do.
 */
export interface SchemaAnnotations {
  readonly title?: string
  readonly description?: string
  readonly [I18N]?: Readonly<Record<string, SchemaI18nEntry>>
}

export interface TextSchema extends SchemaAnnotations {
  readonly type: 'string'
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
}

export interface IntegerSchema extends SchemaAnnotations {
  readonly type: 'integer'
  readonly minimum: number
  readonly maximum: number
}

export interface DecimalSchema extends SchemaAnnotations {
  readonly type: 'string'
  readonly format: typeof DECIMAL_FORMAT
  readonly [MAX_SCALE]: number
  readonly [DECIMAL_MINIMUM]?: string
  readonly [DECIMAL_MAXIMUM]?: string
}

export interface ChoiceSchema extends SchemaAnnotations {
  readonly type: 'string'
  readonly enum: readonly string[]
  readonly [ENUM_LABELS]?: Readonly<Record<string, string>>
}

export interface BooleanSchema extends SchemaAnnotations {
  readonly type: 'boolean'
}

export interface DateSchema extends SchemaAnnotations {
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
  /** the display order of the parameters; validation reads the keys, screens read this */
  readonly [INPUT_ORDER]?: readonly string[]
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

const leap = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/**
 * RFC 3339 full-date on the real calendar, by arithmetic alone: Date.UTC
 * remaps years 0-99 into 1900-1999, so it cannot be trusted at the edges.
 */
export const isDateString = (value: string): boolean => {
  const match = DATE_SYNTAX.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  const days = month === 2 && leap(year) ? 29 : MONTH_DAYS[month - 1]!
  return day <= days
}

const ANNOTATION_KEYS = ['title', 'description', I18N] as const

const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string) =>
  Object.keys(value)
    .filter((key) => !allowed.includes(key) && !ANNOTATION_KEYS.includes(key as never))
    .map((key) => issue(path === '' ? key : `${path}.${key}`, 'unknown-key'))

// BCP-47 in ordinary spelling; wide enough for zh-CN and en, narrow enough
// to refuse arbitrary prose as a locale key
const LOCALE_KEY = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/

const wordIssues = (
  value: unknown,
  path: string,
  key: 'title' | 'description',
): readonly ProfileIssue[] => {
  if (value === undefined) return []
  const limit =
    key === 'title' ? PROFILE_LIMITS.annotationTitleLength : PROFILE_LIMITS.annotationDescriptionLength
  if (typeof value !== 'string') return [issue(`${path}.${key}`, 'annotation-not-a-string')]
  if (value.length > limit) return [issue(`${path}.${key}`, 'annotation-too-long')]
  return []
}

/**
 * The annotation layer's own shape: strings within limits, locales that
 * look like locales, and i18n enumLabels only where there are choices to
 * label - and only for values the enum actually has.
 */
const annotationIssues = (
  value: Record<string, unknown>,
  path: string,
  choices: readonly string[] | null,
): readonly ProfileIssue[] => {
  const found: ProfileIssue[] = []
  found.push(...wordIssues(value['title'], path, 'title'))
  found.push(...wordIssues(value['description'], path, 'description'))
  const i18n = value[I18N]
  if (i18n === undefined) return found
  if (!isRecord(i18n)) {
    found.push(issue(`${path}.${I18N}`, 'not-an-object'))
    return found
  }
  const locales = Object.keys(i18n)
  if (locales.length > PROFILE_LIMITS.annotationLocales)
    found.push(issue(`${path}.${I18N}`, 'too-many-locales'))
  for (const locale of locales) {
    const localePath = `${path}.${I18N}.${locale}`
    if (!LOCALE_KEY.test(locale)) {
      found.push(issue(localePath, 'locale-invalid'))
      continue
    }
    const entry = i18n[locale]
    if (!isRecord(entry)) {
      found.push(issue(localePath, 'not-an-object'))
      continue
    }
    for (const key of Object.keys(entry))
      if (key !== 'title' && key !== 'description' && key !== 'enumLabels')
        found.push(issue(`${localePath}.${key}`, 'unknown-key'))
    found.push(...wordIssues(entry['title'], localePath, 'title'))
    found.push(...wordIssues(entry['description'], localePath, 'description'))
    const labels = entry['enumLabels']
    if (labels === undefined) continue
    if (choices === null) {
      found.push(issue(`${localePath}.enumLabels`, 'labels-without-choices'))
      continue
    }
    if (!isRecord(labels)) {
      found.push(issue(`${localePath}.enumLabels`, 'not-an-object'))
      continue
    }
    for (const [choice, label] of Object.entries(labels)) {
      if (!choices.includes(choice))
        found.push(issue(`${localePath}.enumLabels.${choice}`, 'label-orphan'))
      if (typeof label !== 'string')
        found.push(issue(`${localePath}.enumLabels.${choice}`, 'label-not-a-string'))
      else if (label.length > PROFILE_LIMITS.choiceLabelLength)
        found.push(issue(`${localePath}.enumLabels.${choice}`, 'label-too-long'))
    }
  }
  return found
}

const PARAMETER_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

// a legal identifier, but assigning it mutates the prototype instead of
// defining a property; no scoring parameter gets to be named after that trap
const FORBIDDEN_PARAMETER = '__proto__'

const atomicIssues = (value: unknown, path: string): readonly ProfileIssue[] => {
  if (!isRecord(value)) return [issue(path, 'not-an-object')]
  const type = value['type']
  if (type === 'boolean')
    return [...onlyKeys(value, ['type'], path), ...annotationIssues(value, path, null)]
  if (type === 'integer') {
    const found = [
      ...onlyKeys(value, ['type', 'minimum', 'maximum'], path),
      ...annotationIssues(value, path, null),
    ]
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
    found.push(
      ...annotationIssues(
        value,
        path,
        Array.isArray(choices) && choices.every((choice) => typeof choice === 'string')
          ? (choices as string[])
          : [],
      ),
    )
    if (!Array.isArray(choices) || choices.length === 0) {
      found.push(issue(`${path}.enum`, 'choice-empty'))
      return found
    }
    if (choices.length > PROFILE_LIMITS.choiceOptions)
      found.push(issue(`${path}.enum`, 'choice-too-many'))
    if (!choices.every((choice) => typeof choice === 'string'))
      found.push(issue(`${path}.enum`, 'choice-not-a-string'))
    else {
      if (new Set(choices).size !== choices.length)
        found.push(issue(`${path}.enum`, 'choice-duplicate'))
      if (
        choices.some(
          (choice: string) => choice === '' || choice.length > PROFILE_LIMITS.choiceValueLength,
        )
      )
        found.push(issue(`${path}.enum`, 'choice-value-invalid'))
    }
    const labels = value[ENUM_LABELS]
    if (labels !== undefined) {
      if (!isRecord(labels)) found.push(issue(`${path}.${ENUM_LABELS}`, 'not-an-object'))
      else {
        for (const [key, label] of Object.entries(labels)) {
          if (!choices.includes(key))
            found.push(issue(`${path}.${ENUM_LABELS}.${key}`, 'label-orphan'))
          if (typeof label !== 'string')
            found.push(issue(`${path}.${ENUM_LABELS}.${key}`, 'label-not-a-string'))
          else if (label.length > PROFILE_LIMITS.choiceLabelLength)
            found.push(issue(`${path}.${ENUM_LABELS}.${key}`, 'label-too-long'))
        }
      }
    }
    return found
  }

  const format = value['format']
  if (format === 'date')
    return [...onlyKeys(value, ['type', 'format'], path), ...annotationIssues(value, path, null)]
  if (format === DECIMAL_FORMAT) {
    const found = [
      ...onlyKeys(value, ['type', 'format', MAX_SCALE, DECIMAL_MINIMUM, DECIMAL_MAXIMUM], path),
      ...annotationIssues(value, path, null),
    ]
    const maxScale = value[MAX_SCALE]
    if (
      typeof maxScale !== 'number' ||
      !Number.isInteger(maxScale) ||
      maxScale < 0 ||
      maxScale > PROFILE_LIMITS.decimalMaxScale
    )
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

  const found = [
    ...onlyKeys(value, ['type', 'minLength', 'maxLength', 'pattern'], path),
    ...annotationIssues(value, path, null),
  ]
  for (const key of ['minLength', 'maxLength'] as const) {
    const bound = value[key]
    if (bound === undefined) continue
    if (
      typeof bound !== 'number' ||
      !Number.isInteger(bound) ||
      bound < 0 ||
      bound > PROFILE_LIMITS.textLengthBound
    )
      found.push(issue(`${path}.${key}`, 'length-bound-invalid'))
  }
  const minLength = value['minLength']
  const maxLength = value['maxLength']
  if (typeof minLength === 'number' && typeof maxLength === 'number' && minLength > maxLength)
    found.push(issue(path, 'bounds-inverted'))
  const pattern = value['pattern']
  // only the SHAPE here: whether the pattern belongs to the frozen regex
  // profile is ./regex's patternIssues, which the host adds explicitly - the
  // engine must never ride into a formula artifact just because the schema
  // constructors run there
  if (pattern !== undefined && typeof pattern !== 'string')
    found.push(issue(`${path}.pattern`, 'pattern-invalid'))
  return found
}

/** structural validity of one atomic schema; empty means legal */
export const validateAtomicProfile = (value: unknown): readonly ProfileIssue[] =>
  atomicIssues(value, '')

/** structural validity of a flat input schema; empty means legal */
export const validateInputProfile = (value: unknown): readonly ProfileIssue[] => {
  if (!isRecord(value)) return [issue('', 'not-an-object')]
  const found = [
    ...onlyKeys(value, ['type', 'properties', 'required', 'additionalProperties', INPUT_ORDER], ''),
    ...annotationIssues(value, '', null),
  ]
  if (value['type'] !== 'object') found.push(issue('type', 'unknown-kind'))
  if (value['additionalProperties'] !== false)
    found.push(issue('additionalProperties', 'additional-properties-not-false'))
  const properties = value['properties']
  if (!isRecord(properties)) {
    found.push(issue('properties', 'not-an-object'))
    return found
  }
  const names = Object.keys(properties)
  if (names.length > PROFILE_LIMITS.inputParameters)
    found.push(issue('properties', 'too-many-parameters'))
  for (const [name, property] of Object.entries(properties)) {
    if (
      !PARAMETER_NAME.test(name) ||
      name === FORBIDDEN_PARAMETER ||
      name.length > PROFILE_LIMITS.parameterNameLength
    )
      found.push(issue(`properties.${name}`, 'parameter-name-invalid'))
    found.push(...atomicIssues(property, `properties.${name}`))
  }
  const required = value['required']
  if (
    !Array.isArray(required) ||
    required.length !== names.length ||
    !names.every((name) => required.includes(name))
  )
    found.push(issue('required', 'required-mismatch'))
  const order = value[INPUT_ORDER]
  if (order !== undefined) {
    // a display order names every parameter exactly once, or it is not an
    // order of THESE parameters
    if (
      !Array.isArray(order) ||
      order.length !== names.length ||
      !order.every((name) => typeof name === 'string') ||
      new Set(order).size !== order.length ||
      !names.every((name) => order.includes(name))
    )
      found.push(issue(INPUT_ORDER, 'order-not-a-permutation'))
  }
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

declare const NormalizedMark: unique symbol

/** an atomic schema that went through normalize: frozen, canonical bounds */
export type NormalizedAtomicSchema = AtomicSchema & { readonly [NormalizedMark]: 'atomic' }

/** an input schema that went through normalize: frozen, sorted, complete */
export type NormalizedInputSchema = InputSchema & { readonly [NormalizedMark]: 'input' }

/**
 * A structurally-shared normal form of a legal schema: keys sorted, decimal
 * bounds canonicalized, everything deep-frozen. Callers validate first; this
 * throws on a schema the profile rejected. The brand on the return type is
 * what downstream caches (the ajv validator's WeakMap) rely on: a normalized
 * schema never mutates, so compiling it once is sound.
 */
/** byte-stable spelling of the annotation layer: nested records sorted */
const normalizedAnnotations = (schema: SchemaAnnotations): Record<string, unknown> => {
  const i18n = schema[I18N]
  return {
    ...(schema.title === undefined ? {} : { title: schema.title }),
    ...(schema.description === undefined ? {} : { description: schema.description }),
    ...(i18n === undefined
      ? {}
      : {
          [I18N]: sorted(
            Object.fromEntries(
              Object.entries(i18n).map(([locale, entry]) => [
                locale,
                sorted({
                  ...(entry.title === undefined ? {} : { title: entry.title }),
                  ...(entry.description === undefined ? {} : { description: entry.description }),
                  ...(entry.enumLabels === undefined
                    ? {}
                    : { enumLabels: sorted({ ...entry.enumLabels }) }),
                }),
              ]),
            ),
          ),
        }),
  }
}

export const normalizeAtomicSchema = (schema: AtomicSchema): NormalizedAtomicSchema => {
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
      ...normalizedAnnotations(decimal),
      ...(minimum === undefined ? {} : { [DECIMAL_MINIMUM]: canonicalDecimal(minimum)! }),
      ...(maximum === undefined ? {} : { [DECIMAL_MAXIMUM]: canonicalDecimal(maximum)! }),
    }
    return deepFreeze(sorted(normalized)) as NormalizedAtomicSchema
  }
  if (kind === 'choice') {
    const choice = schema as ChoiceSchema
    const labels = choice[ENUM_LABELS]
    return deepFreeze(
      sorted({
        ...choice,
        ...normalizedAnnotations(choice),
        enum: [...choice.enum],
        ...(labels === undefined ? {} : { [ENUM_LABELS]: sorted({ ...labels }) }),
      }),
    ) as unknown as NormalizedAtomicSchema
  }
  return deepFreeze(
    sorted({ ...schema, ...normalizedAnnotations(schema) }),
  ) as NormalizedAtomicSchema
}

export const normalizeInputSchema = (schema: InputSchema): NormalizedInputSchema => {
  const wrong = validateInputProfile(schema)
  if (wrong.length > 0)
    throw new TypeError(`not a profile input: ${wrong[0]!.path} ${wrong[0]!.reason}`)
  const names = Object.keys(schema.properties).sort()
  const order = schema[INPUT_ORDER]
  return deepFreeze({
    type: 'object',
    properties: Object.fromEntries(
      names.map((name) => [name, normalizeAtomicSchema(schema.properties[name]!)]),
    ),
    required: names,
    additionalProperties: false,
    // the semantic body sorts; what people see keeps the authored order
    ...(order === undefined ? {} : { [INPUT_ORDER]: [...order] }),
    ...normalizedAnnotations(schema as SchemaAnnotations),
  }) as unknown as NormalizedInputSchema
}
