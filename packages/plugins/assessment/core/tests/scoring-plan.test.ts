import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  normalizeAtomicSchema,
  normalizeInputSchema,
  INTEGER_TO_DECIMAL,
} from '@qualy/value-schema'
import { builtinScoringDrivers, fixed1 } from '../src/scoring/builtins.ts'
import { compileScoringPlan } from '../src/scoring/plan.ts'
import type { RecognitionSource } from '../src/scoring/plan.ts'
import type { AtomicSchema } from '@qualy/value-schema'
import type {
  BatchContext,

  CalculatorContract,
  CalculatorDriver,
  ItemTypeDriver,
  ScoringDriver,
} from '../src/plugin.ts'

// Compiling a question's arithmetic: what the calculator needs, proven
// against what the configuration binds to it, before anything is stored.
//
// The production world has one calculator with no parameters at all, so the
// interesting half of this machinery would never run in a suite that only
// used fixed@1. The calculator below is a test instrument, not a business
// rule: it exists so that "every parameter bound exactly once, and provably"
// is asserted here rather than discovered when the first real one arrives.

const decimal = (maxScale: number): AtomicSchema => ({
  type: 'string',
  format: 'qualy-decimal',
  'x-qualy-maxScale': maxScale,
})

/** what a scoring answer has to look like: bounded by the platform amount */
const scoreAmount: AtomicSchema = {
  type: 'string',
  format: 'qualy-decimal',
  'x-qualy-maxScale': 2,
  'x-qualy-minimum': '-99999999.99',
  'x-qualy-maximum': '99999999.99',
}

const contractOf = (properties: Record<string, AtomicSchema>): CalculatorContract => {
  const inputSchema = normalizeInputSchema({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  })
  const outputSchema = normalizeAtomicSchema(scoreAmount)
  return { inputSchema, outputSchema, contractHash: `test:${Object.keys(properties).join(',')}` }
}

/** a calculator with real parameters, so bindings have something to prove */
const graded: CalculatorDriver = {
  kind: 'calculator',
  ref: 'graded-test@1',
  configSchema: Schema.Struct({}),
  compile: (config) =>
    Effect.succeed({
      config,
      ...contractOf({
        level: { type: 'string', enum: ['national', 'provincial'] },
        ordinal: { type: 'integer', minimum: 1, maximum: 10 },
        base: decimal(2),
      }),
    }),
  evaluate: () => Effect.succeed('1.00'),
}

/** one whose answer no score can carry: proof of the output gate */
const overflowing: CalculatorDriver = {
  kind: 'calculator',
  ref: 'overflowing-test@1',
  configSchema: Schema.Struct({}),
  compile: (config) =>
    Effect.succeed({
      config,
      inputSchema: normalizeInputSchema({
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      }),
      outputSchema: normalizeAtomicSchema(decimal(9)),
      contractHash: 'test:overflowing',
    }),
  evaluate: () => Effect.succeed('1.00'),
}

const fields: Record<string, AtomicSchema> = {
  'claimed-level': { type: 'string', enum: ['national', 'provincial'] },
  'claimed-ordinal': { type: 'integer', minimum: 1, maximum: 10 },
  'wide-ordinal': { type: 'integer', minimum: 0, maximum: 99 },
  'claimed-count': { type: 'integer', minimum: 0, maximum: 9 },
  // the same shape as 'claimed-ordinal', except a filing may leave it out
  'optional-ordinal': { type: 'integer', minimum: 1, maximum: 10 },
}

const itemType: ItemTypeDriver = {
  id: 'test-bindable',
  configSchema: Schema.Struct({}),
  decodePayload: (_config, payload) => Effect.succeed(payload),
  attachmentRefs: () => [],
  bindableFields: () =>
    // 'optional-ordinal' stands for a field a filing may leave out; the
    // rest are always written
    Object.entries(fields).map(([fieldId, schema]) => ({
      fieldId,
      schema,
      always: fieldId !== 'optional-ordinal',
    })),
  interaction: 'entry',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
}

const batch: BatchContext = { materialRange: { start: '2026-01-01', end: '2026-12-31' } }

const calculators = new Map<string, ScoringDriver>([
  [fixed1.ref, fixed1],
  [graded.ref, graded],
  [overflowing.ref, overflowing],
])
const aggregators = new Map<string, ScoringDriver>(
  builtinScoringDrivers.filter((driver) => driver.kind === 'aggregator').map((d) => [d.ref, d]),
)

const compile = (
  scoringConfig: unknown,
  over: Partial<{ recognitionSource: RecognitionSource }> = {},
) =>
  Effect.runPromise(
    compileScoringPlan({
      calculators,
      aggregators,
      itemType,
      formConfig: {},
      scoringConfig,
      batch,
      recognitionSource: over.recognitionSource ?? 'review',
    }),
  )

const reasons = (outcome: Awaited<ReturnType<typeof compile>>) =>
  'issues' in outcome ? outcome.issues.map((issue) => `${issue.path}:${issue.reason}`) : []

const fixedConfig = {
  calculator: { ref: 'fixed@1', config: { value: '3.00' } },
  aggregator: { ref: 'sum@1', config: {} },
}

const gradedConfig = (over: Record<string, unknown> = {}) => ({
  calculator: { ref: 'graded-test@1', config: {} },
  aggregator: { ref: 'sum@1', config: {} },
  recognitions: {
    'rec-level': { label: '认定级别', defaultFromFieldId: 'claimed-level' },
    'rec-ordinal': { label: '认定序位', defaultFromFieldId: 'claimed-ordinal' },
  },
  bindings: {
    level: { kind: 'recognition', recognitionId: 'rec-level' },
    ordinal: { kind: 'recognition', recognitionId: 'rec-ordinal' },
    base: { kind: 'constant', value: '3.00' },
  },
  ...over,
})

describe('a fixed question', () => {
  it('compiles to an empty plan, and its output fits a score', async () => {
    const outcome = await compile(fixedConfig)
    expect(reasons(outcome)).toEqual([])
    if (!('plan' in outcome)) throw new Error('expected a plan')
    expect(outcome.plan.parameters).toEqual({})
    expect(outcome.plan.recognitionSchemas).toEqual({})
    expect(outcome.plan.defaultBindings).toEqual({})
    // the plan carries the amount as the calculator will execute it, not as
    // the administrator spelled it: "3.00" and "3.0" are one arithmetic and
    // must not read as two different plans
    expect(outcome.plan.calculator).toMatchObject({ ref: 'fixed@1', config: { value: '3' } })
    expect(outcome.plan.aggregator).toEqual({ ref: 'sum@1', config: {} })
    expect(outcome.plan.planHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('has a plan identity that survives a relabelled schema but not a changed amount', async () => {
    const same = await compile(fixedConfig)
    const other = await compile({
      ...fixedConfig,
      calculator: { ref: 'fixed@1', config: { value: '4.00' } },
    })
    if (!('plan' in same) || !('plan' in other)) throw new Error('expected plans')
    const again = await compile(fixedConfig)
    if (!('plan' in again)) throw new Error('expected a plan')
    expect(again.plan.planHash).toBe(same.plan.planHash)
    expect(other.plan.planHash).not.toBe(same.plan.planHash)
  })
})

describe('binding a calculator that has parameters', () => {
  it('binds each one exactly once and records how the value travels', async () => {
    const outcome = await compile(gradedConfig())
    expect(reasons(outcome)).toEqual([])
    if (!('plan' in outcome)) throw new Error('expected a plan')
    expect(outcome.plan.parameters).toEqual({
      level: { kind: 'recognition', recognitionId: 'rec-level', assignment: { kind: 'direct' } },
      ordinal: { kind: 'recognition', recognitionId: 'rec-ordinal', assignment: { kind: 'direct' } },
      base: { kind: 'constant', value: '3.00' },
    })
    expect(Object.keys(outcome.plan.recognitionSchemas).sort()).toEqual(['rec-level', 'rec-ordinal'])
    expect(outcome.plan.defaultBindings).toEqual({
      'rec-level': { fieldId: 'claimed-level', assignment: { kind: 'direct' } },
      'rec-ordinal': { fieldId: 'claimed-ordinal', assignment: { kind: 'direct' } },
    })
  })

  it('refuses a parameter nobody bound, and a binding for a parameter nobody has', async () => {
    const missing = await compile(
      gradedConfig({
        bindings: {
          level: { kind: 'recognition', recognitionId: 'rec-level' },
          ordinal: { kind: 'recognition', recognitionId: 'rec-ordinal' },
        },
      }),
    )
    expect(reasons(missing)).toContain('scoringConfig.bindings.base:binding-missing')

    const extra = await compile(
      gradedConfig({
        bindings: {
          ...gradedConfig().bindings,
          nobody: { kind: 'constant', value: '1.00' },
        },
      }),
    )
    expect(reasons(extra)).toContain('scoringConfig.bindings.nobody:binding-unknown-parameter')
  })

  it('refuses seeding a self-approving question from a field that may be absent', async () => {
    // nobody is asked afterwards, so a default is the whole determination:
    // taking it from a field a filing may leave out produces a claim that
    // is approved and cannot be scored
    const config = gradedConfig({
      recognitions: { 'rec-ordinal': { defaultFromFieldId: 'optional-ordinal' } },
      bindings: {
        ordinal: { kind: 'recognition', recognitionId: 'rec-ordinal' },
        level: { kind: 'constant', value: 'national' },
        base: { kind: 'constant', value: '3.00' },
      },
    })
    expect(reasons(await compile(config, { recognitionSource: 'automatic' }))).toContain(
      'scoringConfig.recognitions.rec-ordinal:default-field-not-guaranteed',
    )
    // where somebody will be asked, a default is only a starting point and
    // an absent field is nothing to refuse over
    expect(reasons(await compile(config))).toEqual([])
    expect(reasons(await compile(config, { recognitionSource: 'administrative' }))).toEqual([])
  })

  it('refuses one determination standing in for two parameters', async () => {
    // both would prove their own type against it and the last one written
    // would decide what reviewers are actually validated against
    const outcome = await compile(
      gradedConfig({
        recognitions: { 'rec-shared': { defaultFromFieldId: null } },
        bindings: {
          level: { kind: 'recognition', recognitionId: 'rec-shared' },
          ordinal: { kind: 'recognition', recognitionId: 'rec-shared' },
          base: { kind: 'constant', value: '3.00' },
        },
      }),
    )
    expect(reasons(outcome)).toContain('scoringConfig.bindings.ordinal:recognition-reused')
  })

  it('refuses a constant the parameter would not admit', async () => {
    const outcome = await compile(
      gradedConfig({
        bindings: { ...gradedConfig().bindings, base: { kind: 'constant', value: 'three' } },
      }),
    )
    expect(reasons(outcome).some((reason) => reason.startsWith('scoringConfig.bindings.base:constant-'))).toBe(true)
  })

  it('refuses a default field whose values the recognition would not admit', async () => {
    // the field allows 0 and 99; the parameter allows 1..10, so some legal
    // filing would be an illegal recognition - proof, not a spot check
    const outcome = await compile(
      gradedConfig({
        recognitions: {
          'rec-level': { defaultFromFieldId: 'claimed-level' },
          'rec-ordinal': { defaultFromFieldId: 'wide-ordinal' },
        },
      }),
    )
    expect(
      reasons(outcome).some((reason) =>
        reason.startsWith('scoringConfig.recognitions.rec-ordinal:default-'),
      ),
    ).toBe(true)
  })

  it('refuses a default field nobody declares, and a recognition nobody reads', async () => {
    const unknown = await compile(
      gradedConfig({
        recognitions: {
          'rec-level': { defaultFromFieldId: 'claimed-level' },
          'rec-ordinal': { defaultFromFieldId: 'no-such-field' },
        },
      }),
    )
    expect(reasons(unknown)).toContain(
      'scoringConfig.recognitions.rec-ordinal:default-field-unknown',
    )

    const orphan = await compile(
      gradedConfig({
        recognitions: { ...gradedConfig().recognitions, 'rec-ghost': { defaultFromFieldId: null } },
      }),
    )
    expect(reasons(orphan)).toContain('scoringConfig.recognitions.rec-ghost:recognition-unbound')
  })

  it('records the integer-to-decimal converter by name rather than performing it later', async () => {
    const outcome = await compile({
      calculator: { ref: 'graded-test@1', config: {} },
      aggregator: { ref: 'sum@1', config: {} },
      recognitions: {
        'rec-level': { defaultFromFieldId: 'claimed-level' },
        'rec-ordinal': { defaultFromFieldId: 'claimed-ordinal' },
        'rec-base': { defaultFromFieldId: 'claimed-count' },
      },
      bindings: {
        level: { kind: 'recognition', recognitionId: 'rec-level' },
        ordinal: { kind: 'recognition', recognitionId: 'rec-ordinal' },
        base: { kind: 'recognition', recognitionId: 'rec-base' },
      },
    })
    expect(reasons(outcome)).toEqual([])
    if (!('plan' in outcome)) throw new Error('expected a plan')
    // the field counts whole things; the parameter takes a decimal. The
    // conversion is legal, named, and stored - never re-decided at scoring
    expect(outcome.plan.defaultBindings['rec-base']).toEqual({
      fieldId: 'claimed-count',
      assignment: { kind: 'convert', converter: INTEGER_TO_DECIMAL },
    })
  })
})

describe('what a question may not be saved as', () => {
  it('refuses arithmetic nobody installed, and an aggregator nobody installed', async () => {
    expect(
      reasons(await compile({ ...fixedConfig, calculator: { ref: 'ghost@1', config: {} } })),
    ).toEqual(['scoringConfig.calculator.ref:calculator-not-installed'])
    expect(
      reasons(await compile({ ...fixedConfig, aggregator: { ref: 'ghost@1', config: {} } })),
    ).toContain('scoringConfig.aggregator.ref:aggregator-not-installed')
  })

  it('refuses an answer no score could carry', async () => {
    const outcome = await compile({
      calculator: { ref: 'overflowing-test@1', config: {} },
      aggregator: { ref: 'sum@1', config: {} },
    })
    expect(reasons(outcome)).toContain('scoringConfig.calculator:output-not-a-score-amount')
  })

  it('refuses a shape that is not a scoring configuration at all', async () => {
    expect(reasons(await compile({ calculator: 'fixed@1' }))).toEqual([
      'scoringConfig:scoring-config-shape',
    ])
  })

  it('refuses a recognition nobody can ever fill - but only where nobody reviews', async () => {
    const unattainable = {
      calculator: { ref: 'graded-test@1', config: {} },
      aggregator: { ref: 'sum@1', config: {} },
      recognitions: {
        'rec-level': { defaultFromFieldId: 'claimed-level' },
        // no default, so only a reviewer could ever determine it
        'rec-ordinal': { defaultFromFieldId: null },
      },
      bindings: {
        level: { kind: 'recognition', recognitionId: 'rec-level' },
        ordinal: { kind: 'recognition', recognitionId: 'rec-ordinal' },
        base: { kind: 'constant', value: '3.00' },
      },
    }
    // a question that answers to nobody has nobody to determine it: the
    // submission is the decision, so an unseeded fact could never be filled
    expect(reasons(await compile(unattainable, { recognitionSource: 'automatic' }))).toContain(
      'scoringConfig.recognitions.rec-ordinal:recognition-unattainable',
    )
    // a reviewed question is exactly how a reviewer-only fact is configured
    expect(reasons(await compile(unattainable))).toEqual([])
    // and so is an administrative one: the member of staff recording the
    // fact is its author, which is the whole point of a field the student
    // never claims
    expect(reasons(await compile(unattainable, { recognitionSource: 'administrative' }))).toEqual([])
    // nobody files a derived question, so nothing about it can be determined
    expect(reasons(await compile(unattainable, { recognitionSource: 'none' }))).toContain(
      'scoringConfig.recognitions:recognition-without-determiner',
    )
  })
})
