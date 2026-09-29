/**
 * The sandbox budget one scoring invocation runs under.
 *
 * Deliberately NOT the authoring try-run budget (2s/10s): scoring executes
 * per entry inside a results read. The soft deadline is the one value the
 * rollout benchmarks calibrated, in this one place: it is wall-clock over
 * the whole worker-side envelope (runtime, bootstrap, artifact, run), so
 * host scheduling jitter counts against it, and the sandbox's strict 25ms
 * was crossed once by a healthy formula on a loaded host; 50ms held across
 * every measured window. The hard deadline is the deployment's to set
 * (`QUALY_SANDBOX_HARD_DEADLINE_MS`, see below).
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

import { LIMIT_CEILINGS, MAX_COMPILED_ARTIFACT_BYTES } from '@qualy/sandbox-rpc'

/** the engine's own interrupt: the budget a formula is held to */
export const FORMULA_SOFT_DEADLINE_MS = 50

/**
 * The host watchdog, when the deployment names none.
 *
 * It is the backstop for a worker that has stopped answering, not a budget
 * a formula is held to - that is the soft deadline, enforced by the engine
 * itself. The sandbox default of 100ms was sized on a development machine;
 * on the production host (2 vCPU at 2.4GHz under KVM) a healthy fresh
 * worker's first evaluation reached 139ms, and the wall clock it measures
 * also holds whatever the hypervisor takes. A healthy worker killed there
 * takes the account read with it; a wedged one living 400ms longer costs
 * nothing (docs/deployment.md, 2026-09-29).
 */
export const DEFAULT_SCORING_HARD_DEADLINE_MS = 500

/** the watchdog never fires before the engine has had three chances to interrupt */
export const HARD_DEADLINE_SOFT_MULTIPLE = 3

/** the scoring budget under a given watchdog */
export const formulaScoringLimits = (hardDeadlineMs: number) =>
  Object.freeze({
    softDeadlineMs: FORMULA_SOFT_DEADLINE_MS,
    hardDeadlineMs,
    artifactBytes: MAX_COMPILED_ARTIFACT_BYTES,
    inputBytes: 512 * 1024,
    outputBytes: 64 * 1024,
  })

export type FormulaScoringLimits = ReturnType<typeof formulaScoringLimits>

/** why a configured watchdog is refused, or undefined when it is not */
export const hardDeadlineIssue = (hardDeadlineMs: number): string | undefined => {
  const least = FORMULA_SOFT_DEADLINE_MS * HARD_DEADLINE_SOFT_MULTIPLE
  if (!Number.isSafeInteger(hardDeadlineMs)) return 'must be a whole number of milliseconds'
  if (hardDeadlineMs < least) {
    return `must be at least ${String(least)} (${String(HARD_DEADLINE_SOFT_MULTIPLE)} soft deadlines of ${String(FORMULA_SOFT_DEADLINE_MS)}ms)`
  }
  if (hardDeadlineMs > LIMIT_CEILINGS.hardDeadlineMs) {
    return `must be at most ${String(LIMIT_CEILINGS.hardDeadlineMs)}`
  }
  return undefined
}

/** the budget when the deployment names no watchdog */
export const FORMULA_SCORING_LIMITS = formulaScoringLimits(DEFAULT_SCORING_HARD_DEADLINE_MS)
