/**
 * The value form's state model, deliberately split from the wire value: a
 * person mid-edit legitimately holds "", "-", "1." - shapes no schema
 * admits - so the form keeps a DRAFT per field and only materialization
 * produces a wire value, which then faces validateValue as the one judge.
 *
 * PRESENCE is part of the model: an absent key means the person has not
 * answered, which is never the same thing as an answer that happens to be
 * "" or false. A determination has to be MADE - a boolean nobody touched
 * must not materialize as an explicit false, and an untouched text field
 * must not materialize as an explicit empty string. Only an onDraft from
 * the person sets a key; materializing an absent one is 'empty'.
 *
 * Kind by kind, once set:
 *   text     draft string        -> string ('' is a legal answer)
 *   integer  draft string        -> safe integer number
 *   decimal  draft string        -> canonical decimal string
 *   choice   draft string ('' = unchosen) -> stable id
 *   boolean  draft boolean       -> boolean
 *   date     draft string        -> YYYY-MM-DD string
 *
 * Nothing here is Formula-specific: the same model drives any screen that
 * collects values for a @qualy/value-schema contract.
 */

import {
  canonicalDecimal,
  inputOrder,
  kindOf,
  normalizeAtomicSchema,
  parseDecimal,
  type AtomicSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import { validateValue as validate, type ValueIssue } from '@qualy/value-schema/validate'

export type FieldDraft = string | boolean

/**
 * One field as this model sees it: an opaque stable id and the schema its
 * value answers to. The id is NOT a value-schema parameter name - a
 * recognition id, a column key, anything a caller uses to address a value
 * is welcome here - which is what lets one form model serve contracts whose
 * identities were never meant to be identifiers.
 */
export interface ValueFieldSpec {
  readonly id: string
  readonly schema: AtomicSchema
}

/** an input contract's parameters as fields, in the authored order */
export const fieldsOfInput = (schema: NormalizedInputSchema): readonly ValueFieldSpec[] =>
  inputOrder(schema).flatMap((name) => {
    const property = schema.properties[name]
    return property === undefined ? [] : [{ id: name, schema: property }]
  })

/** what one field's draft materializes to */
export type FieldOutcome =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly reason: string }

const INTEGER_SYNTAX = /^-?\d+$/

/** a stored wire value, redrawn as an editable draft; lossless for legal
 * values, string-rendered for everything else so nothing silently drops.
 * No stored value means no draft - absence survives the round trip */
export const draftFromValue = (schema: AtomicSchema, value: unknown): FieldDraft | undefined => {
  if (value === undefined || value === null) return undefined
  const kind = kindOf(schema)
  if (kind === 'boolean') return value === true
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** one field: draft -> wire value, or the reason it cannot be one yet */
export const materializeField = (
  schema: AtomicSchema,
  draft: FieldDraft | undefined,
): FieldOutcome => {
  // nobody answered: not false, not "", just not answered
  if (draft === undefined) return { kind: 'empty' }
  const kind = kindOf(schema)
  if (kind === 'boolean') return { kind: 'value', value: draft === true || draft === 'true' }
  const text = typeof draft === 'string' ? draft : String(draft)
  if (kind === 'integer') {
    const trimmed = text.trim()
    if (trimmed === '') return { kind: 'empty' }
    if (!INTEGER_SYNTAX.test(trimmed) || !Number.isSafeInteger(Number(trimmed)))
      return { kind: 'invalid', reason: 'not-an-integer' }
    return { kind: 'value', value: Number(trimmed) }
  }
  if (kind === 'decimal') {
    const trimmed = text.trim()
    if (trimmed === '') return { kind: 'empty' }
    if (parseDecimal(trimmed) === null) return { kind: 'invalid', reason: 'not-a-decimal' }
    return { kind: 'value', value: canonicalDecimal(trimmed) }
  }
  // choice, date and text all carry the string itself; emptiness means
  // unanswered for choice/date, and is a legal answer only for text
  if (text === '' && kind !== 'text') return { kind: 'empty' }
  return { kind: 'value', value: text }
}

export interface MaterializedInput {
  readonly value: Record<string, unknown> | null
  /** field name -> what stops it; '' keys whole-object issues */
  readonly issues: ReadonlyMap<string, string>
}

/**
 * The whole form: every field materialized, then each value put before
 * validateValue - bounds, patterns and enums all judged by the same
 * validator the server uses. Every field is required: emptiness is an
 * issue, because a contract's fields are its fields.
 */
export const materializeFields = (
  fields: readonly ValueFieldSpec[],
  drafts: Readonly<Record<string, FieldDraft>>,
): MaterializedInput => {
  const issues = new Map<string, string>()
  const value: Record<string, unknown> = {}
  for (const field of fields) {
    const outcome = materializeField(field.schema, drafts[field.id])
    if (outcome.kind === 'empty') {
      issues.set(field.id, 'required')
      continue
    }
    if (outcome.kind === 'invalid') {
      issues.set(field.id, outcome.reason)
      continue
    }
    // the judge wants the canonical spelling of the schema; callers hand
    // whatever spelling they hold, and normalizing a handful of form fields
    // costs nothing
    const wrong = validate(normalizeAtomicSchema(field.schema), outcome.value)
    if (wrong.length > 0) {
      issues.set(field.id, wrong[0]!.reason)
      continue
    }
    value[field.id] = outcome.value
  }
  return issues.size > 0 ? { value: null, issues } : { value, issues }
}

/** the input-contract face of materializeFields, for callers with a schema */
export const materializeInput = (
  schema: NormalizedInputSchema,
  drafts: Readonly<Record<string, FieldDraft>>,
): MaterializedInput => materializeFields(fieldsOfInput(schema), drafts)

/** which stored values survive a (possibly changed) contract untouched */
export const reconcileStored = (
  schema: NormalizedInputSchema,
  stored: unknown,
): { readonly legal: boolean; readonly issues: readonly ValueIssue[] } => {
  const issues = validate(schema, stored)
  return { legal: issues.length === 0, issues }
}

export const draftsFromFields = (
  fields: readonly ValueFieldSpec[],
  stored: unknown,
): Record<string, FieldDraft> => {
  const record =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {}
  return Object.fromEntries(
    fields.flatMap((field) => {
      const draft = draftFromValue(field.schema, record[field.id])
      return draft === undefined ? [] : [[field.id, draft]]
    }),
  )
}

/** the input-contract face of draftsFromFields */
export const draftsFromStored = (
  schema: NormalizedInputSchema,
  stored: unknown,
): Record<string, FieldDraft> => draftsFromFields(fieldsOfInput(schema), stored)
