// How one claim is briefly identified, everywhere it is listed (§32.74).
//
// One projection for every surface - the participant's paper, the review
// queue, the overview feed - so "which claim is this" has a single answer.
// The administrator picks up to three fields on the item's display config;
// without a configuration the projection falls back to the first fields
// that can actually identify anything: non-attachment, non-empty, in form
// order. A pure module with no imports: the server projects it into
// responses and the browser projects the payloads it already holds.

export interface EntrySummaryPart {
  readonly fieldId: string
  readonly label: string
  readonly value: string
}

interface FormField {
  readonly id?: string
  readonly key?: string
  readonly label?: string
  readonly type?: string
  readonly options?: readonly { readonly value?: string; readonly label?: string }[]
}

/** a field's identity across item revisions: its id, or its founding key */
const identityOf = (field: FormField): string | null =>
  typeof field.id === 'string' ? field.id : typeof field.key === 'string' ? field.key : null

const valueOf = (payload: Record<string, unknown>, field: FormField): string => {
  const value = field.key === undefined ? undefined : payload[field.key]
  if (typeof value === 'string') {
    // a choice stores its stable value; the summary owes the reader the
    // words the administrator wrote for it
    if (field.type === 'choice' && Array.isArray(field.options)) {
      const chosen = field.options.find((option) => option.value === value)
      if (chosen !== undefined && typeof chosen.label === 'string') return chosen.label
    }
    return value.trim()
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

export const SUMMARY_FIELDS_MOST = 3

/** the field ids the item's display config elects, in their order */
export const summaryFieldIdsOf = (displayConfig: unknown): readonly string[] => {
  const ids = (displayConfig as { entrySummary?: { fieldIds?: unknown } } | null | undefined)
    ?.entrySummary?.fieldIds
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

/**
 * The claim's identity line. Configured fields come back in the configured
 * order, empty values included - a table drawn from these parts must keep
 * its columns even where one row left a blank. The fallback keeps only
 * fields that identify something: attachments and blanks are skipped, and
 * a claim whose form says nothing at all returns no parts, leaving the
 * surface to fall back to the item's own title.
 */
export const projectEntrySummary = (input: {
  formConfig: unknown
  displayConfig: unknown
  payload: unknown
}): readonly EntrySummaryPart[] => {
  const fields = (input.formConfig as { fields?: unknown } | null | undefined)?.fields
  if (!Array.isArray(fields)) return []
  const record = (input.payload ?? {}) as Record<string, unknown>
  const configured = summaryFieldIdsOf(input.displayConfig)
  if (configured.length > 0) {
    const byIdentity = new Map<string, FormField>()
    for (const field of fields as readonly FormField[]) {
      const identity = identityOf(field)
      if (identity !== null && !byIdentity.has(identity)) byIdentity.set(identity, field)
    }
    return configured
      .flatMap((id) => {
        const field = byIdentity.get(id)
        if (field === undefined || field.type === 'attachment') return []
        return [
          {
            fieldId: id,
            label: typeof field.label === 'string' ? field.label : (field.key ?? id),
            value: valueOf(record, field),
          },
        ]
      })
      .slice(0, SUMMARY_FIELDS_MOST)
  }
  const parts: EntrySummaryPart[] = []
  for (const field of fields as readonly FormField[]) {
    if (parts.length >= SUMMARY_FIELDS_MOST) break
    const identity = identityOf(field)
    if (identity === null || field.type === 'attachment') continue
    const value = valueOf(record, field)
    if (value === '') continue
    parts.push({
      fieldId: identity,
      label: typeof field.label === 'string' ? field.label : (field.key ?? identity),
      value,
    })
  }
  return parts
}
