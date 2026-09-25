/**
 * What a report row's `defect` says when the host, not the engine, decided
 * the case: fixed tokens, so a screen can say them in its reader's language.
 * Anything else in `defect` is what the engine reported, verbatim.
 */

/** held back: an earlier case in the same run was interrupted */
export const CASE_NOT_RUN = 'not-run'

/** passed as it was tried, and could not be scored within the scoring budget's time */
export const OVER_SCORING_BUDGET = 'over-scoring-budget'

/** passed as it was tried, and failed when run under the scoring budget's limits */
export const FAILED_UNDER_SCORING_BUDGET = 'failed-under-scoring-budget'
