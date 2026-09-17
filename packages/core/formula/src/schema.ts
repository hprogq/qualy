/**
 * The author-facing schema constructors. There is no second type language
 * here: every constructor returns the @qualy/value-schema profile object
 * itself, normalized and deep-frozen, with nothing added at runtime — the
 * generics only preserve literal knowledge (which choices, which
 * parameters) so Static<S> can hand the formula body its exact types.
 */

import {
  normalizeAtomicSchema,
  normalizeInputSchema,
  type AtomicSchema,
  type BooleanSchema,
  type ChoiceSchema,
  type DateSchema,
  type DecimalSchema,
  type InputSchema,
  type IntegerSchema,
  type SchemaI18nEntry,
  type TextSchema,
} from '@qualy/value-schema'
import type { Decimal } from './decimal.ts'

/**
 * The words a parameter carries for people: a default title/description and
 * optional translations. Pure annotation - never part of what values the
 * contract admits, never part of a contract hash.
 */
export interface Annotations {
  readonly title?: string
  readonly description?: string
  readonly i18n?: Readonly<Record<string, SchemaI18nEntry>>
}

const annotated = (words?: Annotations): Record<string, unknown> => ({
  ...(words?.title === undefined ? {} : { title: words.title }),
  ...(words?.description === undefined ? {} : { description: words.description }),
  ...(words?.i18n === undefined ? {} : { 'x-qualy-i18n': words.i18n }),
})

declare const DateType: unique symbol

/** a calendar date carried as its RFC 3339 string; never a JS Date */
export type DateString = string & { readonly [DateType]: 'date' }

export type ChoiceOf<K extends string> = ChoiceSchema & { readonly enum: readonly K[] }

export type InputOf<P extends Record<string, AtomicSchema>> = InputSchema & {
  readonly properties: Readonly<P>
}

/** the static type a schema admits inside the formula body */
export type Static<S> = S extends { readonly enum: readonly (infer K extends string)[] }
  ? K
  : S extends { readonly format: 'qualy-decimal' }
    ? Decimal
    : S extends { readonly format: 'date' }
      ? DateString
      : S extends { readonly type: 'integer' }
        ? number
        : S extends { readonly type: 'boolean' }
          ? boolean
          : S extends { readonly type: 'string' }
            ? string
            : never

export type StaticInput<S extends InputSchema> = S extends { readonly properties: infer P }
  ? { readonly [K in keyof P]: Static<P[K]> }
  : never

const text = (
  bounds?: {
    readonly minLength?: number
    readonly maxLength?: number
    readonly pattern?: string
  } & Annotations,
): TextSchema => {
  const { minLength, maxLength, pattern } = bounds ?? {}
  return normalizeAtomicSchema({
    type: 'string',
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(pattern === undefined ? {} : { pattern }),
    ...annotated(bounds),
  } as TextSchema) as TextSchema
}

// an integer schema always carries explicit bounds: JSON parsing loses
// precision past the safe range, so "unbounded" spells the safe range out
const integer = (
  bounds?: {
    readonly minimum?: number
    readonly maximum?: number
  } & Annotations,
): IntegerSchema =>
  normalizeAtomicSchema({
    type: 'integer',
    minimum: bounds?.minimum ?? Number.MIN_SAFE_INTEGER,
    maximum: bounds?.maximum ?? Number.MAX_SAFE_INTEGER,
    ...annotated(bounds),
  } as IntegerSchema) as IntegerSchema

const decimal = (
  bounds?: {
    readonly maxScale?: number
    readonly minimum?: string
    readonly maximum?: string
  } & Annotations,
): DecimalSchema => {
  const { maxScale, minimum, maximum } = bounds ?? {}
  return normalizeAtomicSchema({
    type: 'string',
    format: 'qualy-decimal',
    // the scorer's fixed point is 1e-4; a formula that needs another scale says so
    'x-qualy-maxScale': maxScale ?? 4,
    ...(minimum === undefined ? {} : { 'x-qualy-minimum': minimum }),
    ...(maximum === undefined ? {} : { 'x-qualy-maximum': maximum }),
    ...annotated(bounds),
  } as DecimalSchema) as DecimalSchema
}

const choice = <const Options extends Record<string, string>>(
  options: Options,
  words?: Annotations,
): ChoiceOf<keyof Options & string> =>
  normalizeAtomicSchema({
    type: 'string',
    enum: Object.keys(options),
    'x-qualy-enumLabels': options,
    ...annotated(words),
  } as ChoiceSchema) as ChoiceOf<keyof Options & string>

const boolean = (words?: Annotations): BooleanSchema =>
  normalizeAtomicSchema({ type: 'boolean', ...annotated(words) } as BooleanSchema) as BooleanSchema

const date = (words?: Annotations): DateSchema =>
  normalizeAtomicSchema({
    type: 'string',
    format: 'date',
    ...annotated(words),
  } as DateSchema) as DateSchema

/**
 * What the assessment scorer can actually carry: the platform's amount is a
 * 1e-4 fixed-point number inside numeric(12,4), so a formula that is going
 * to score MUST answer inside these walls. `Schema.decimal()` alone is
 * unbounded and therefore not publishable as a score - this is the output
 * contract publication checks against, and the constructor formulas reach
 * for.
 */
const scoreAmount = (
  bounds?: {
    readonly maxScale?: number
    readonly minimum?: string
    readonly maximum?: string
  } & Annotations,
): DecimalSchema => {
  const maxScale = bounds?.maxScale ?? 4
  // numeric(12,4)'s widest magnitude, spelled at the declared scale so the
  // bound itself never outruns the precision it bounds
  const edge = maxScale === 0 ? '99999999' : `99999999.${'9'.repeat(Math.min(maxScale, 4))}`
  return decimal({
    maxScale,
    minimum: bounds?.minimum ?? `-${edge}`,
    maximum: bounds?.maximum ?? edge,
    ...(bounds?.title === undefined ? {} : { title: bounds.title }),
    ...(bounds?.description === undefined ? {} : { description: bounds.description }),
    ...(bounds?.i18n === undefined ? {} : { i18n: bounds.i18n }),
  })
}

const input = <const P extends Record<string, AtomicSchema>>(properties: P): InputOf<P> =>
  normalizeInputSchema({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
    // the authored order IS the display order; the semantic body sorts
    'x-qualy-order': Object.keys(properties),
  }) as unknown as InputOf<P>

export const Schema = Object.freeze({
  text,
  integer,
  decimal,
  scoreAmount,
  choice,
  boolean,
  date,
  input,
})

/** the widest output a publishable scoring formula may declare */
export const SCORE_AMOUNT_SCHEMA: DecimalSchema = scoreAmount()
