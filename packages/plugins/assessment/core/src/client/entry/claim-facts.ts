// What a claim's own row says of it beside its name: the last thing that
// happened to it and when, a reviewer's words it carries, and how many files
// its current version holds.
//
// Every list that shows a claim reads these three off the claim the same
// way, so one claim is never said to have been returned in one list and
// submitted in another. The shape asked for is the loosest one those lists
// hold, and nothing here says any of it in words: each list names the act
// in its own catalog.

/** the last thing that happened to a claim */
export type ClaimAct =
  | 'asked'
  | 'returned'
  | 'refused'
  | 'recorded'
  | 'approved'
  | 'submitted'
  | 'revoked'
  | 'abandoned'
  | 'saved'

/** a reviewer's words a claim carries: what to add, why it came back, or why it was refused */
export interface ClaimNote {
  readonly kind: 'ask' | 'return' | 'refusal'
  readonly text: string
}

/** what the three readings need of a claim */
export interface ClaimFactsSource {
  readonly status: string
  readonly source?: string | null | undefined
  readonly createdAt?: string | undefined
  readonly currentRevision?:
    | { readonly payload: unknown; readonly createdAt: string }
    | null
    | undefined
  /** an open ask for more material: when it was asked, and what for */
  readonly supplement?: unknown
  /** what it stands determined as, and when that was decided */
  readonly recognition?: { readonly createdAt: string } | null | undefined
  /** why it came back or was refused, while it stands so */
  readonly refusal?:
    | {
        readonly at?: string | undefined
        readonly comment?: string | null | undefined
        readonly reason?: string | null | undefined
      }
    | null
    | undefined
}

/** a fact the office recorded rather than one somebody filed */
const byOffice = (claim: ClaimFactsSource): boolean =>
  claim.source === 'record' || claim.source === 'import'

/** the reviewer's open ask on a claim, however loosely the list holds it */
const askOf = (
  claim: ClaimFactsSource,
): { readonly requestedAt: string | null; readonly instructions: string } | null => {
  const ask = claim.supplement
  if (ask === null || ask === undefined || typeof ask !== 'object') return null
  const { requestedAt, instructions } = ask as { requestedAt?: unknown; instructions?: unknown }
  return {
    requestedAt: typeof requestedAt === 'string' ? requestedAt : null,
    instructions: typeof instructions === 'string' ? instructions.trim() : '',
  }
}

/** a reviewer is waiting on more material for it */
export const claimAsked = (claim: ClaimFactsSource): boolean => askOf(claim) !== null

/**
 * The last thing that happened to a claim and when: an open ask outranks the
 * claim's own state, and a fact the office recorded is recorded or revoked
 * rather than approved or given up.
 */
export const claimActOf = (claim: ClaimFactsSource): { act: ClaimAct; at: string | null } => {
  const revised = claim.currentRevision?.createdAt ?? claim.createdAt ?? null
  const ask = askOf(claim)
  if (ask !== null) return { act: 'asked', at: ask.requestedAt ?? revised }
  switch (claim.status) {
    case 'needs_revision':
      return { act: 'returned', at: claim.refusal?.at ?? revised }
    case 'rejected':
      return {
        act: 'refused',
        at: claim.refusal?.at ?? claim.recognition?.createdAt ?? revised,
      }
    case 'approved':
      return {
        act: byOffice(claim) ? 'recorded' : 'approved',
        at: claim.recognition?.createdAt ?? revised,
      }
    case 'in_review':
      return { act: 'submitted', at: revised }
    case 'voided':
      return { act: byOffice(claim) ? 'revoked' : 'abandoned', at: revised }
    default:
      return { act: 'saved', at: revised }
  }
}

/** the reviewer's words a claim carries, while they still stand; blank words are none */
export const claimNoteOf = (claim: ClaimFactsSource): ClaimNote | null => {
  const ask = askOf(claim)
  if (ask !== null) return ask.instructions === '' ? null : { kind: 'ask', text: ask.instructions }
  const said = (claim.refusal?.comment ?? claim.refusal?.reason ?? '').trim()
  if (said === '') return null
  if (claim.status === 'needs_revision') return { kind: 'return', text: said }
  if (claim.status === 'rejected') return { kind: 'refusal', text: said }
  return null
}

/** how many files the claim's current version holds, over the question's file fields */
export const claimFilesOf = (claim: ClaimFactsSource, formConfig: unknown): number => {
  const fields = (formConfig as { fields?: unknown } | null | undefined)?.fields
  const payload = claim.currentRevision?.payload
  if (!Array.isArray(fields) || payload === null || typeof payload !== 'object') return 0
  let count = 0
  for (const field of fields as readonly { key?: unknown; type?: unknown }[]) {
    if (field.type !== 'attachment' || typeof field.key !== 'string') continue
    // a field key is a word somebody chose; one every object answers to is
    // not a file field this claim filled in
    if (!Object.hasOwn(payload, field.key)) continue
    const value = (payload as Record<string, unknown>)[field.key]
    if (Array.isArray(value)) count += value.length
  }
  return count
}
