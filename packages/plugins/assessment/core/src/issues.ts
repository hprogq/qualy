/**
 * How many field problems one refusal names.
 *
 * A payload is whatever its caller sent, and a refusal that names every
 * unknown key of a two-megabyte object is itself a many-megabyte response,
 * built while the round's lock is held. Fifty is far more than any form has
 * fields; past it the refusal says there was more, and the caller fixes what
 * it was shown first.
 */
export const MAX_ISSUES = 50

/** the reason the last kept issue carries when more were cut */
export const TRUNCATED = 'truncated'

/** at most `MAX_ISSUES` issues, and a closing `truncated` one when some were cut */
export const boundIssues = <T extends { readonly field: string; readonly reason: string }>(
  issues: readonly T[],
): readonly (T | { readonly field: string; readonly reason: string })[] =>
  issues.length <= MAX_ISSUES
    ? issues
    : [...issues.slice(0, MAX_ISSUES), { field: '', reason: TRUNCATED }]
