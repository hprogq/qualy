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
  type TextSchema,
} from '@qualy/value-schema'
import type { Decimal } from './decimal.ts'

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

const text = (bounds?: {
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
}): TextSchema => {
  const { minLength, maxLength, pattern } = bounds ?? {}
  return normalizeAtomicSchema({
    type: 'string',
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(pattern === undefined ? {} : { pattern }),
  }) as TextSchema
}

// an integer schema always carries explicit bounds: JSON parsing loses
// precision past the safe range, so "unbounded" spells the safe range out
const integer = (bounds?: {
  readonly minimum?: number
  readonly maximum?: number
}): IntegerSchema =>
  normalizeAtomicSchema({
    type: 'integer',
    minimum: bounds?.minimum ?? Number.MIN_SAFE_INTEGER,
    maximum: bounds?.maximum ?? Number.MAX_SAFE_INTEGER,
  }) as IntegerSchema

const decimal = (bounds?: {
  readonly maxScale?: number
  readonly minimum?: string
  readonly maximum?: string
}): DecimalSchema => {
  const { maxScale, minimum, maximum } = bounds ?? {}
  return normalizeAtomicSchema({
    type: 'string',
    format: 'qualy-decimal',
    // the scorer's fixed point is 1e-4; a formula that needs another scale says so
    'x-qualy-maxScale': maxScale ?? 4,
    ...(minimum === undefined ? {} : { 'x-qualy-minimum': minimum }),
    ...(maximum === undefined ? {} : { 'x-qualy-maximum': maximum }),
  }) as DecimalSchema
}

const choice = <const Options extends Record<string, string>>(
  options: Options,
): ChoiceOf<keyof Options & string> =>
  normalizeAtomicSchema({
    type: 'string',
    enum: Object.keys(options),
    'x-qualy-enumLabels': options,
  }) as ChoiceOf<keyof Options & string>

const boolean = (): BooleanSchema => normalizeAtomicSchema({ type: 'boolean' }) as BooleanSchema

const date = (): DateSchema =>
  normalizeAtomicSchema({ type: 'string', format: 'date' }) as DateSchema

const input = <const P extends Record<string, AtomicSchema>>(properties: P): InputOf<P> =>
  normalizeInputSchema({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  }) as InputOf<P>

export const Schema = Object.freeze({ text, integer, decimal, choice, boolean, date, input })
