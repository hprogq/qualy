import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { builtinAggregators } from '../src/scoring/builtins.ts'
import { compileScoringPlan, type ScoringPlan } from '../src/scoring/plan.ts'
import {
  evaluateRecognition,
  type RecognitionEvaluationFact,
  type ScoringEvaluationFailed,
} from '../src/scoring/evaluate.ts'
import { CalculatorEvaluationError, type PreparedCalculator } from '../src/plugin.ts'
import { testDefinitions, testHost, testRuntime, twoFactTest } from './support/catalogs.ts'

// What one determination is worth, and - when it is worth nothing - why.
//
// The calculator's own word for a failure is the one thing the three
// callers (counting an account, proving a determination before it becomes
// a fact, trying a rule that is not saved yet) decide by. So it has to
// arrive here untouched, and the two failures this primitive finds on its
// own have to arrive sorted the same way.

const R_LEVEL = '01920000-0000-7000-8000-000000000201'
const R_ORDINAL = '01920000-0000-7000-8000-000000000202'

const registrations = [twoFactTest]
const definitions = testDefinitions(registrations, builtinAggregators)
const runtime = testRuntime(registrations)

/** the two-fact fixture bound to two determinations, no form behind it */
const plan = await Effect.runPromise(
  compileScoringPlan({
    definitions,
    compile: runtime.compile,
    host: testHost,
    itemType: undefined,
    formConfig: {},
    scoringConfig: {
      version: 2,
      calculator: { ref: 'two-fact-test@1', config: {} },
      aggregator: { ref: 'sum@1', config: {} },
      recognitions: {
        [R_LEVEL]: { label: '级别', refinement: null, defaultFromFieldId: null },
        [R_ORDINAL]: { label: '序位', refinement: null, defaultFromFieldId: null },
      },
      bindings: {
        level: { kind: 'recognition', recognitionId: R_LEVEL },
        ordinal: { kind: 'recognition', recognitionId: R_ORDINAL },
      },
    },
    batch: { materialRange: { start: '2026-01-01', end: '2026-12-31' } },
    recognitionSource: 'review',
  }),
).then((outcome) => {
  if (!('plan' in outcome)) throw new Error(`fixture did not compile: ${JSON.stringify(outcome)}`)
  return outcome.plan as ScoringPlan
})

const fact = (recognition: Record<string, unknown>): RecognitionEvaluationFact => ({
  itemId: 'item-under-test',
  plan,
  recognition,
})

const lawful = { [R_LEVEL]: 'national', [R_ORDINAL]: 3 }

const answering = (answer: string): PreparedCalculator => ({
  evaluate: () => Effect.succeed(answer),
})
const failing = (kind: CalculatorEvaluationError['kind'], reason: string): PreparedCalculator => ({
  evaluate: () => Effect.fail(new CalculatorEvaluationError(kind, reason)),
})

const failureOf = (exit: Exit.Exit<unknown, ScoringEvaluationFailed>) => {
  if (Exit.isSuccess(exit)) throw new Error('expected the evaluation to fail')
  const failure = exit.cause.reasons.find((reason) => reason._tag === 'Fail')
  if (failure === undefined || failure._tag !== 'Fail') throw new Error('expected a typed failure')
  return failure.error
}

describe('evaluating one determination', () => {
  it('scales a lawful answer exactly, naming the arithmetic that gave it', async () => {
    const evaluated = await Effect.runPromise(evaluateRecognition(answering('7.5'), fact(lawful)))
    expect(evaluated).toEqual({ amount: 75_000n, calculatorRef: 'two-fact-test@1' })
  })

  it("carries the calculator's own word for a failure, whichever it was", async () => {
    // a refusal is the rule saying no to these values; an outage is the
    // arithmetic being out of reach. Both are the calculator's to say, and
    // neither may arrive as the other
    const refused = failureOf(
      await Effect.runPromiseExit(
        evaluateRecognition(failing('refusal', 'only the first ten'), fact(lawful)),
      ),
    )
    expect(refused.kind).toBe('refusal')
    expect(refused.reason).toBe('only the first ten')
    expect(refused.itemId).toBe('item-under-test')
    const out = failureOf(
      await Effect.runPromiseExit(
        evaluateRecognition(failing('unavailable', 'the sandbox is gone'), fact(lawful)),
      ),
    )
    expect(out.kind).toBe('unavailable')
    for (const kind of ['execution', 'integrity', 'invariant'] as const) {
      expect(
        failureOf(
          await Effect.runPromiseExit(evaluateRecognition(failing(kind, kind), fact(lawful))),
        ).kind,
      ).toBe(kind)
    }
  })

  it('reads an answer the frozen contract refuses as a program that failed to compute', async () => {
    // the program ran and returned; what it returned is not a lawful
    // amount. That is not the rule refusing these values
    const wrong = failureOf(
      await Effect.runPromiseExit(evaluateRecognition(answering('not a number'), fact(lawful))),
    )
    expect(wrong.kind).toBe('execution')
    expect(wrong.reason.startsWith('output ')).toBe(true)
  })

  it('reads an input the frozen contract refuses as an invariant this process broke', async () => {
    // the input was assembled from stored facts: a determination nobody
    // could have admitted under this plan means the plan and the
    // determination have come apart on the host's side
    const broken = failureOf(
      await Effect.runPromiseExit(
        evaluateRecognition(answering('1.00'), fact({ [R_LEVEL]: 'galactic', [R_ORDINAL]: 3 })),
      ),
    )
    expect(broken.kind).toBe('invariant')
    expect(broken.reason.startsWith('input ')).toBe(true)
  })
})
