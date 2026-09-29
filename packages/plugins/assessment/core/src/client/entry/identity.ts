import { projectEntrySummary } from '../../entry/summary.ts'

// A claim's identity line in parts, the way every list that names claims
// reads it (§32.74): its words as filed first, then its figures, each beside
// the name of the field it was filed under. "97.29 6 139" says nothing;
// "average 97.29, rank 6, of 139" says what the claim is. A word filed under
// a field reads as itself and is not named.

/**
 * One part of a claim's identity line: a value as filed, and - for a figure,
 * which says nothing without it - the name of the field it was filed under.
 */
export interface LinePart {
  readonly label: string | null
  readonly value: string
}

/** a part, knowing whether it is a figure - which a list may say elsewhere */
export interface IdentityPart extends LinePart {
  readonly numeric: boolean
}

const NUMERIC = new Set(['integer', 'decimal'])

interface FormField {
  readonly id?: string
  readonly key?: string
  readonly type?: string
}

/** the claim's identity, words before figures, blanks left out */
export const identityPartsOf = (input: {
  formConfig: unknown
  displayConfig: unknown
  payload: unknown
}): readonly IdentityPart[] => {
  const fields = (input.formConfig as { fields?: unknown } | null | undefined)?.fields
  const typeOf = new Map(
    (Array.isArray(fields) ? (fields as readonly FormField[]) : []).map(
      (field) => [field.id ?? field.key ?? '', field.type ?? ''] as const,
    ),
  )
  const parts = projectEntrySummary(input).filter((part) => part.value !== '')
  const numeric = (fieldId: string) => NUMERIC.has(typeOf.get(fieldId) ?? '')
  return [
    ...parts
      .filter((part) => !numeric(part.fieldId))
      .map((part) => ({ label: null, value: part.value, numeric: false })),
    ...parts
      .filter((part) => numeric(part.fieldId))
      .map((part) => ({ label: part.label, value: part.value, numeric: true })),
  ]
}
