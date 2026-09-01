import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { CalculatorRuntimeError } from '../src/plugin.ts'
import { ScoringEvaluationFailed } from '../src/scoring/evaluate.ts'
import {
  mapEvaluationFailure,
  mapRuntimeFailure,
  type FailureSite,
} from '../src/scoring/failure-boundary.ts'
import type { ScoringPlan } from '../src/scoring/plan.ts'

// What a calculator's failure means depends on where the host was standing
// when it met it - and on which half of the arithmetic failed. Preparing
// the arithmetic is the host's business at every boundary: nothing a
// runtime says on the way in is a rule refusing somebody's determination,
// whatever kind it wore. Running it is where the rule speaks.

const site: FailureSite = {
  tenantId: 't',
  batchId: 'b',
  itemId: 'item-under-test',
  plan: {
    version: 1,
    calculator: { ref: 'fixed@1', config: {}, contractHash: 'x' },
  } as ScoringPlan,
}

const evaluation = (kind: ScoringEvaluationFailed['kind']) =>
  new ScoringEvaluationFailed({ itemId: site.itemId, kind, reason: `${kind} said` })

const outcome = async (effect: Effect.Effect<never, unknown>) => {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) throw new Error('a failure mapper does not succeed')
  const reasons = exit.cause.reasons
  const failed = reasons.find((reason) => reason._tag === 'Fail')
  if (failed !== undefined && failed._tag === 'Fail') {
    return { tag: (failed.error as { _tag: string })._tag }
  }
  return { tag: 'died' }
}

describe('a calculator failure at the settlement boundary', () => {
  it("hands the rule's refusal to the person determining, and nothing else", async () => {
    expect(await outcome(mapEvaluationFailure('settlement', site, evaluation('refusal')))).toEqual({
      tag: 'ASSESSMENT_DETERMINATION_REFUSED',
    })
    expect(
      await outcome(mapEvaluationFailure('settlement', site, evaluation('unavailable'))),
    ).toEqual({ tag: 'ASSESSMENT_SCORING_UNAVAILABLE' })
    for (const kind of ['execution', 'integrity', 'invariant'] as const) {
      expect(await outcome(mapEvaluationFailure('settlement', site, evaluation(kind)))).toEqual({
        tag: 'died',
      })
    }
  })

  it('never reads a runtime declining to prepare as the rule refusing a determination', async () => {
    // the same word, on the way in: a defect, not a sentence for the reviewer
    expect(
      await outcome(
        mapRuntimeFailure('settlement', site, new CalculatorRuntimeError('refusal', 'no')),
      ),
    ).toEqual({ tag: 'died' })
    expect(
      await outcome(
        mapRuntimeFailure('settlement', site, new CalculatorRuntimeError('unavailable', 'gone')),
      ),
    ).toEqual({ tag: 'ASSESSMENT_SCORING_UNAVAILABLE' })
    for (const kind of ['execution', 'integrity', 'invariant'] as const) {
      expect(
        await outcome(
          mapRuntimeFailure('settlement', site, new CalculatorRuntimeError(kind, kind)),
        ),
      ).toEqual({ tag: 'died' })
    }
  })
})

describe('a calculator failure while reading an account', () => {
  it('retries an outage and dies on everything else, a refusal included', async () => {
    // what stands as a fact was proven against the rule before it stood, so
    // a refusal here is a state this process should never have allowed
    expect(await outcome(mapEvaluationFailure('result', site, evaluation('unavailable')))).toEqual({
      tag: 'ASSESSMENT_SCORING_UNAVAILABLE',
    })
    expect(await outcome(mapEvaluationFailure('result', site, evaluation('refusal')))).toEqual({
      tag: 'died',
    })
    expect(
      await outcome(mapRuntimeFailure('result', site, new CalculatorRuntimeError('refusal', 'no'))),
    ).toEqual({ tag: 'died' })
  })
})
