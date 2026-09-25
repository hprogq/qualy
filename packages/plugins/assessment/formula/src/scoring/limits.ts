/**
 * The sandbox budget one scoring invocation runs under.
 *
 * Deliberately NOT the authoring try-run budget (2s/10s): scoring executes
 * per entry inside a results read. The soft deadline is the one value the
 * rollout benchmarks calibrated, in this one place: it is wall-clock over
 * the whole worker-side envelope (runtime, bootstrap, artifact, run), so
 * host scheduling jitter counts against it, and the sandbox's strict 25ms
 * was crossed once by a healthy formula on a loaded host; 50ms held across
 * every measured window. The hard deadline stays the sandbox default - the
 * outer bound on a runaway worker did not move.
 *
 * The artifact budget is the one hard rule here: publishable must mean
 * executable. The sandbox default admits only 256KiB, while publication
 * admits MAX_COMPILED_ARTIFACT_BYTES - without this override a lawfully
 * published large formula would score as ArtifactTooLarge forever, which
 * is a host-inflicted invariant breach, not a data problem. Time is held
 * to the same rule from the other side: publication asks its examples once
 * more under this budget (./invoke.ts), so a version whose own examples
 * cannot be scored in it is not published. Input and output ride on
 * explicit transport budgets rather than the engine's 8MiB ceiling: the
 * input is one JSON object of at most 64 host-validated parameters, the
 * output is one envelope holding an amount or a capped failure message.
 */

import { DEFAULT_LIMITS, MAX_COMPILED_ARTIFACT_BYTES } from '@qualy/sandbox-rpc'

export const FORMULA_SCORING_LIMITS = Object.freeze({
  softDeadlineMs: 50,
  hardDeadlineMs: DEFAULT_LIMITS.hardDeadlineMs,
  artifactBytes: MAX_COMPILED_ARTIFACT_BYTES,
  inputBytes: 512 * 1024,
  outputBytes: 64 * 1024,
})
