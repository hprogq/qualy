import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS, LIMIT_CEILINGS, MAX_COMPILED_ARTIFACT_BYTES } from '@qualy/sandbox-rpc'
import {
  DEFAULT_SCORING_HARD_DEADLINE_MS,
  FORMULA_SCORING_LIMITS,
  formulaScoringLimits,
  hardDeadlineIssue,
} from '../src/scoring/limits.ts'

describe('the scoring budget', () => {
  it('runs a formula under a 50ms soft deadline and a watchdog several of them long', () => {
    // calibrated, not chosen: the soft deadline is wall-clock over the whole
    // worker-side envelope, and 25ms was crossed once by a healthy formula
    // under host scheduling jitter; 50ms held across 181,200 invocations,
    // quiet and loaded alike. The watchdog is the backstop for a worker that
    // stopped answering, sized on the production host rather than taken
    // from the sandbox default (docs/deployment.md, 2026-09-29).
    expect(FORMULA_SCORING_LIMITS.softDeadlineMs).toBe(50)
    expect(FORMULA_SCORING_LIMITS.softDeadlineMs).toBe(DEFAULT_LIMITS.softDeadlineMs * 2)
    expect(FORMULA_SCORING_LIMITS.hardDeadlineMs).toBe(DEFAULT_SCORING_HARD_DEADLINE_MS)
    expect(DEFAULT_SCORING_HARD_DEADLINE_MS).toBe(500)
  })

  it('takes a watchdog of the deployment only where the engine has had three chances first', () => {
    expect(hardDeadlineIssue(DEFAULT_SCORING_HARD_DEADLINE_MS)).toBeUndefined()
    expect(hardDeadlineIssue(150)).toBeUndefined()
    expect(hardDeadlineIssue(149)).toMatch(/at least 150/)
    expect(hardDeadlineIssue(LIMIT_CEILINGS.hardDeadlineMs + 1)).toMatch(/at most/)
    expect(hardDeadlineIssue(250.5)).toMatch(/whole number/)
    expect(formulaScoringLimits(900).hardDeadlineMs).toBe(900)
    expect(formulaScoringLimits(900).softDeadlineMs).toBe(50)
  })

  it('admits every artifact publication admits', () => {
    expect(FORMULA_SCORING_LIMITS.artifactBytes).toBe(MAX_COMPILED_ARTIFACT_BYTES)
  })
})
