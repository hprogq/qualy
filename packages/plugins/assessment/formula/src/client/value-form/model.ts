/**
 * The value form's state model, deliberately split from the wire value: a
 * person mid-edit legitimately holds "", "-", "1." - shapes no schema
 * admits - so the form keeps a DRAFT per field and only materialization
 * produces a wire value, which then faces validateValue as the one judge.
 *
 * Kind by kind:
 *   text     draft string        -> string
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
  kindOf,
  parseDecimal,
  type AtomicSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import { validateValue as validate, type ValueIssue } from '@qualy/value-schema/validate'

export type FieldDraft = string | boolean

/** what one field's draft materializes to */
export type FieldOutcome =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly reason: string }

const INTEGER_SYNTAX = /^-?\d+$/

/** a stored wire value, redrawn as an editable draft; lossless for legal
 * values, string-rendered for everything else so nothing silently drops */
export const draftFromValue = (schema: AtomicSchema, value: unknown): FieldDraft => {
  const kind = kindOf(schema)
  if (kind === 'boolean') return value === true
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** one field: draft -> wire value, or the reason it cannot be one yet */
export const materializeField = (schema: AtomicSchema, draft: FieldDraft): FieldOutcome => {
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
 * The whole form: every field materialized, then the assembled object put
 * before validateValue - bounds, patterns and enums all judged by the same
 * validator the server uses.
 */
export const materializeInput = (
  schema: NormalizedInputSchema,
  drafts: Readonly<Record<string, FieldDraft>>,
): MaterializedInput => {
  const issues = new Map<string, string>()
  const value: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(schema.properties)) {
    const outcome = materializeField(property, drafts[name] ?? '')
    if (outcome.kind === 'empty') {
      issues.set(name, 'required')
      continue
    }
    if (outcome.kind === 'invalid') {
      issues.set(name, outcome.reason)
      continue
    }
    value[name] = outcome.value
  }
  if (issues.size > 0) return { value: null, issues }
  for (const issue of validate(schema, value)) {
    const field = issue.path.startsWith('/') ? issue.path.slice(1).split('/')[0]! : ''
    if (!issues.has(field)) issues.set(field, issue.reason)
  }
  return issues.size > 0 ? { value: null, issues } : { value, issues }
}

/** which stored values survive a (possibly changed) contract untouched */
export const reconcileStored = (
  schema: NormalizedInputSchema,
  stored: unknown,
): { readonly legal: boolean; readonly issues: readonly ValueIssue[] } => {
  const issues = validate(schema, stored)
  return { legal: issues.length === 0, issues }
}

export const draftsFromStored = (
  schema: NormalizedInputSchema,
  stored: unknown,
): Record<string, FieldDraft> => {
  const record =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {}
  return Object.fromEntries(
    Object.entries(schema.properties).map(([name, property]) => [
      name,
      draftFromValue(property, record[name]),
    ]),
  )
}
