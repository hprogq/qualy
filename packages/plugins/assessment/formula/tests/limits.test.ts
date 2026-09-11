import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS, MAX_COMPILED_ARTIFACT_BYTES } from '@qualy/sandbox-rpc'
import { FORMULA_SCORING_LIMITS } from '../src/scoring/limits.ts'

describe('the scoring budget', () => {
  it('runs a formula under a 50ms soft deadline and the sandbox default hard one', () => {
    // calibrated, not chosen: the soft deadline is wall-clock over the whole
    // worker-side envelope, and 25ms was crossed once by a healthy formula
    // under host scheduling jitter; 50ms held across 181,200 invocations,
    // quiet and loaded alike. The hard watchdog stays where the sandbox
    // puts it, so a runaway worker's outer bound did not move.
    expect(FORMULA_SCORING_LIMITS.softDeadlineMs).toBe(50)
    expect(FORMULA_SCORING_LIMITS.softDeadlineMs).toBe(DEFAULT_LIMITS.softDeadlineMs * 2)
    expect(FORMULA_SCORING_LIMITS.hardDeadlineMs).toBe(DEFAULT_LIMITS.hardDeadlineMs)
  })

  it('admits every artifact publication admits', () => {
    expect(FORMULA_SCORING_LIMITS.artifactBytes).toBe(MAX_COMPILED_ARTIFACT_BYTES)
  })
})
