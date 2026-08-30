/**
 * How a screen reads the annotation layer: one fallback chain per kind of
 * word, ending at the machine identity so a schema with no annotations
 * still renders. Pure functions on the schema value - browser-safe, no
 * hashing, no validation.
 *
 * The chain is deliberately short (exact locale, then the default words,
 * then the identifier); language-tag fallback like zh-CN -> zh is a later
 * ruling if it is ever needed.
 */

import {
  ENUM_LABELS,
  I18N,
  INPUT_ORDER,
  type AtomicSchema,
  type ChoiceSchema,
  type InputSchema,
  type SchemaI18nEntry,
} from './profile.ts'

/**
 * Own-property read for records whose keys are BUSINESS values. A choice's
 * stable value may legally spell 'toString', 'constructor' or '__proto__',
 * and a plain property access on a partial record would then hand back
 * Object.prototype's machinery instead of falling through - a function
 * where a label belongs. Every lookup keyed by a business string goes
 * through here.
 */
// captured hasOwnProperty, es5-spelled: this module compiles into every
// formula artifact, whose staged workspace and sandbox predate Object.hasOwn
const hasOwn = Object.prototype.hasOwnProperty

const own = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record !== undefined && hasOwn.call(record, key) ? (record[key] as T) : undefined

const localeEntry = (
  schema: AtomicSchema | InputSchema,
  locale: string,
): SchemaI18nEntry | undefined =>
  own((schema as { [I18N]?: Readonly<Record<string, SchemaI18nEntry>> })[I18N], locale)

/** the words for one parameter: locale title, default title, then the key */
export const displayTitle = (schema: AtomicSchema, key: string, locale: string): string =>
  localeEntry(schema, locale)?.title ?? schema.title ?? key

export const displayDescription = (schema: AtomicSchema, locale: string): string | undefined =>
  localeEntry(schema, locale)?.description ?? schema.description

/** the words for one choice value: locale label, default label, the value */
export const choiceLabel = (schema: ChoiceSchema, value: string, locale: string): string =>
  own(localeEntry(schema, locale)?.enumLabels, value) ?? own(schema[ENUM_LABELS], value) ?? value

/** the parameter order a form renders in; the semantic sort is not it */
export const inputOrder = (schema: InputSchema): readonly string[] =>
  schema[INPUT_ORDER] ?? Object.keys(schema.properties)
