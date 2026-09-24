import type { EntranceField, EntranceKind, EntranceValue } from '@qualy/auth-contract/login'

// What an entrance's settings hold, read one way everywhere.
//
// The stored config keeps each non-secret field under its own key, parsed to
// its kind - a choice's value, a toggle's boolean, a number - and what the
// driver derived from them under `derived`. A field nobody has set holds its
// default. A field shown only while another holds a given value is judged
// against the values as they stand, defaults included: that is what the
// form shows, what readiness asks of, and what the driver is handed.

/** what the stored config says a field holds, or undefined when it holds nothing */
export const storedValue = (
  field: EntranceField,
  config: Readonly<Record<string, unknown>>,
): EntranceValue | undefined => {
  const raw = config[field.key]
  switch (field.kind) {
    case 'text':
    case 'url':
      return typeof raw === 'string' && raw !== '' ? raw : undefined
    case 'choice':
      return typeof raw === 'string' && field.options.some((option) => option.value === raw)
        ? raw
        : undefined
    case 'toggle':
      return typeof raw === 'boolean' ? raw : undefined
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
    case 'secret':
      return undefined
  }
}

const defaultOf = (field: EntranceField): EntranceValue | undefined =>
  field.kind === 'choice' || field.kind === 'toggle' || field.kind === 'number'
    ? field.defaultValue
    : undefined

/** every non-secret field's value as it stands: stored, or its default */
export const effectiveValues = (
  kind: EntranceKind,
  config: Readonly<Record<string, unknown>>,
): Record<string, EntranceValue> => {
  const values: Record<string, EntranceValue> = {}
  for (const field of kind.fields) {
    if (field.kind === 'secret') continue
    const value = storedValue(field, config) ?? defaultOf(field)
    if (value !== undefined) values[field.key] = value
  }
  return values
}

/** the explicit values alone, which is what the core stores */
export const explicitValues = (
  kind: EntranceKind,
  config: Readonly<Record<string, unknown>>,
): Record<string, EntranceValue> => {
  const values: Record<string, EntranceValue> = {}
  for (const field of kind.fields) {
    if (field.kind === 'secret') continue
    const value = storedValue(field, config)
    if (value !== undefined) values[field.key] = value
  }
  return values
}

/** whether the form shows this field, given what the form holds */
export const visibleIn = (
  field: EntranceField,
  values: Readonly<Record<string, EntranceValue | undefined>>,
) => field.visibleWhen === undefined || values[field.visibleWhen.field] === field.visibleWhen.equals

/** an absolute http(s) address, which is all a url field may hold */
const isWebAddress = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * What was typed into a non-secret box, parsed to the field's kind.
 *
 * An empty box clears the field - back to its default, when it has one.
 * Anything the kind cannot hold is refused rather than coerced.
 */
export const parseTyped = (
  field: EntranceField,
  raw: string,
): { readonly ok: true; readonly value: EntranceValue | undefined } | { readonly ok: false } => {
  const typed = raw.trim()
  if (typed === '') return { ok: true, value: undefined }
  switch (field.kind) {
    case 'text':
      return { ok: true, value: typed }
    case 'url':
      return isWebAddress(typed) ? { ok: true, value: typed } : { ok: false }
    case 'choice':
      return field.options.some((option) => option.value === typed)
        ? { ok: true, value: typed }
        : { ok: false }
    case 'toggle':
      return typed === 'true' || typed === 'false'
        ? { ok: true, value: typed === 'true' }
        : { ok: false }
    case 'number': {
      const value = Number(typed)
      if (!Number.isFinite(value)) return { ok: false }
      if (field.min !== undefined && value < field.min) return { ok: false }
      if (field.max !== undefined && value > field.max) return { ok: false }
      if (field.step !== undefined) {
        const steps = value / field.step
        if (Math.abs(steps - Math.round(steps)) > 1e-9) return { ok: false }
      }
      return { ok: true, value }
    }
    case 'secret':
      return { ok: false }
  }
}

/** a value as a form box carries it */
export const wireOf = (value: EntranceValue) => (typeof value === 'string' ? value : String(value))
