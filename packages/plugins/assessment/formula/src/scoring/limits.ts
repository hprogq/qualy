/**
 * The sandbox budget one scoring invocation runs under.
 *
 * Deliberately NOT the authoring try-run budget (2s/10s): scoring executes
 * per entry inside a results read, and the deadline starts at the sandbox's
 * own strict default - a design value the production benchmarks of the
 * rollout phase get to move, in this one place.
 *
 * The artifact budget is the one hard rule here: publishable must mean
 * executable. The sandbox default admits only 256KiB, while publication
 * admits MAX_COMPILED_ARTIFACT_BYTES - without this override a lawfully
 * published large formula would score as ArtifactTooLarge forever, which
 * is a host-inflicted invariant breach, not a data problem. Input and
 * output ride on explicit transport budgets rather than the engine's 8MiB
 * ceiling: the input is one JSON object of at most 64 host-validated
 * parameters, the output is one envelope holding an amount or a capped
 * failure message.
 */

import { DEFAULT_LIMITS, MAX_COMPILED_ARTIFACT_BYTES } from '@qualy/sandbox-rpc'

export const FORMULA_SCORING_LIMITS = Object.freeze({
  softDeadlineMs: DEFAULT_LIMITS.softDeadlineMs,
  hardDeadlineMs: DEFAULT_LIMITS.hardDeadlineMs,
  artifactBytes: MAX_COMPILED_ARTIFACT_BYTES,
  inputBytes: 512 * 1024,
  outputBytes: 64 * 1024,
})
