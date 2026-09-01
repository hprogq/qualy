import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  normalizeAtomicSchema,
  normalizeInputSchema,
  INTEGER_TO_DECIMAL,
} from '@qualy/value-schema'
import { builtinAggregators, fixed1 } from '../src/scoring/builtins.ts'
import {
  storedRuntimeRefOf,
  storedTest,
  testDefinitions,
  testHost,
  testRuntime,
} from './support/catalogs.ts'
import {
  compileScoringPlan,
  evaluationHash,
  readScoringPlan,
  recognitionEvaluationHash,
} from '../src/scoring/plan.ts'
import type { RecognitionSource } from '../src/scoring/plan.ts'
import type { AtomicSchema } from '@qualy/value-schema'
import { CalculatorContractError } from '../src/plugin.ts'
import type {
  BatchContext,
  CalculatorContract,
  CalculatorRegistration,
  ItemTypeDriver,
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
const graded: CalculatorRegistration = {
  kind: 'calculator',
  ref: 'graded-test@1',
  configSchema: Schema.Struct({}),
  bind: Effect.succeed({
    ref: 'graded-test@1',
    compile: (config) =>
      Effect.succeed({
        config,
        ...contractOf({
          level: { type: 'string', enum: ['national', 'provincial'] },
          ordinal: { type: 'integer', minimum: 1, maximum: 10 },
          base: decimal(2),
        }),
      }),
    verify: () => Effect.void,
    prepare: () => Effect.succeed({ evaluate: () => Effect.succeed('1.00') }),
  }),
}

/** one whose answer no score can carry: proof of the output gate */
const overflowing: CalculatorRegistration = {
  kind: 'calculator',
  ref: 'overflowing-test@1',
  configSchema: Schema.Struct({}),
  bind: Effect.succeed({
    ref: 'overflowing-test@1',
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
    verify: () => Effect.void,
    prepare: () => Effect.succeed({ evaluate: () => Effect.succeed('1.00') }),
  }),
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
      // the address is not the identity, and the plan must freeze the address
      payloadKey: `${fieldId}-slot`,
      schema,
      always: fieldId !== 'optional-ordinal',
    })),
  interaction: 'entry',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
}

const batch: BatchContext = { materialRange: { start: '2026-01-01', end: '2026-12-31' } }

const registrations = [fixed1, graded, overflowing, storedTest]
const definitions = testDefinitions(registrations, builtinAggregators)
const runtime = testRuntime(registrations)

const compile = (
  scoringConfig: unknown,
  over: Partial<{ recognitionSource: RecognitionSource }> = {},
) =>
  Effect.runPromise(
    compileScoringPlan({
      definitions,
      compile: runtime.compile,
      host: testHost,
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
      ordinal: {
        kind: 'recognition',
        recognitionId: 'rec-ordinal',
        assignment: { kind: 'direct' },
      },
      base: { kind: 'constant', value: '3.00' },
    })
    expect(Object.keys(outcome.plan.recognitionSchemas).sort()).toEqual([
      'rec-level',
      'rec-ordinal',
    ])
    expect(outcome.plan.defaultBindings).toEqual({
      'rec-level': {
        fieldId: 'claimed-level',
        // the identity names the field; the ADDRESS is what seeding reads,
        // and the two are deliberately different in this catalog
        payloadKey: 'claimed-level-slot',
        assignment: { kind: 'direct' },
      },
      'rec-ordinal': {
        fieldId: 'claimed-ordinal',
        payloadKey: 'claimed-ordinal-slot',
        assignment: { kind: 'direct' },
      },
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
    expect(
      reasons(outcome).some((reason) => reason.startsWith('scoringConfig.bindings.base:constant-')),
    ).toBe(true)
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
      payloadKey: 'claimed-count-slot',
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
    expect(reasons(await compile(unattainable, { recognitionSource: 'administrative' }))).toEqual(
      [],
    )
    // nobody files a derived question, so nothing about it can be determined
    expect(reasons(await compile(unattainable, { recognitionSource: 'none' }))).toContain(
      'scoringConfig.recognitions:recognition-without-determiner',
    )
  })
})

describe('a V2 configuration refines what a reviewer may determine', () => {
  const R_LEVEL = '01920000-0000-7000-8000-000000000101'
  const R_ORDINAL = '01920000-0000-7000-8000-000000000102'
  const R_BASE = '01920000-0000-7000-8000-000000000103'

  const v2Config = (over: {
    recognitions?: Record<string, unknown>
    bindings?: Record<string, unknown>
  }) => ({
    version: 2,
    calculator: { ref: 'graded-test@1', config: {} },
    aggregator: { ref: 'sum@1', config: {} },
    recognitions: over.recognitions ?? {
      [R_LEVEL]: { label: '认定级别', refinement: null, defaultFromFieldId: 'claimed-level' },
      [R_ORDINAL]: { label: '认定序位', refinement: null, defaultFromFieldId: 'claimed-ordinal' },
    },
    bindings: over.bindings ?? {
      level: { kind: 'recognition', recognitionId: R_LEVEL },
      ordinal: { kind: 'recognition', recognitionId: R_ORDINAL },
      base: { kind: 'constant', value: '3.00' },
    },
  })

  const ordinalRefined = (refinement: unknown) =>
    v2Config({
      recognitions: {
        [R_LEVEL]: { label: '认定级别', refinement: null, defaultFromFieldId: 'claimed-level' },
        [R_ORDINAL]: { label: '认定序位', refinement, defaultFromFieldId: null },
      },
    })

  it('freezes a narrowing, and refuses a widening by name', async () => {
    const narrowed = await compile(ordinalRefined({ type: 'integer', minimum: 2, maximum: 8 }))
    expect('plan' in narrowed).toBe(true)
    if ('plan' in narrowed) {
      const frozen = narrowed.plan.recognitionSchemas[R_ORDINAL] as {
        minimum: number
        maximum: number
        title?: string
      }
      // the refinement IS the frozen contract, label riding as its title
      expect(frozen.minimum).toBe(2)
      expect(frozen.maximum).toBe(8)
      expect(frozen.title).toBe('认定序位')
    }
    const widened = await compile(ordinalRefined({ type: 'integer', minimum: 0, maximum: 20 }))
    expect(reasons(widened)).toContain(
      'scoringConfig.bindings.ordinal:refinement-integer-range-widens',
    )
  })

  it('narrows a choice to a subset, never past it', async () => {
    const subset = await compile(
      v2Config({
        recognitions: {
          [R_LEVEL]: {
            label: '认定级别',
            refinement: { type: 'string', enum: ['national'] },
            defaultFromFieldId: null,
          },
          [R_ORDINAL]: {
            label: '认定序位',
            refinement: null,
            defaultFromFieldId: 'claimed-ordinal',
          },
        },
      }),
    )
    expect('plan' in subset).toBe(true)
    const superset = await compile(
      v2Config({
        recognitions: {
          [R_LEVEL]: {
            label: '认定级别',
            refinement: { type: 'string', enum: ['national', 'provincial', 'municipal'] },
            defaultFromFieldId: null,
          },
          [R_ORDINAL]: {
            label: '认定序位',
            refinement: null,
            defaultFromFieldId: 'claimed-ordinal',
          },
        },
      }),
    )
    expect(reasons(superset)).toContain('scoringConfig.bindings.level:refinement-choice-widens')
  })

  it('calls a conversion a costume: another kind is refused however convertible', async () => {
    // integer proves INTO a decimal parameter by conversion - which is
    // exactly what a refinement is not allowed to be
    const converted = await compile(
      v2Config({
        recognitions: {
          [R_LEVEL]: { label: '认定级别', refinement: null, defaultFromFieldId: 'claimed-level' },
          [R_ORDINAL]: {
            label: '认定序位',
            refinement: null,
            defaultFromFieldId: 'claimed-ordinal',
          },
          [R_BASE]: {
            label: '基础分',
            refinement: { type: 'integer', minimum: 0, maximum: 9 },
            defaultFromFieldId: null,
          },
        },
        bindings: {
          level: { kind: 'recognition', recognitionId: R_LEVEL },
          ordinal: { kind: 'recognition', recognitionId: R_ORDINAL },
          base: { kind: 'recognition', recognitionId: R_BASE },
        },
      }),
    )
    expect(reasons(converted)).toContain(
      'scoringConfig.bindings.base:refinement-requires-conversion',
    )
    const crossed = await compile(ordinalRefined({ type: 'string', minLength: 1, maxLength: 8 }))
    expect(reasons(crossed)).toContain('scoringConfig.bindings.ordinal:refinement-kind-mismatch')
  })

  it('seeds evidence through a conversion into a refined recognition: E into R into P', async () => {
    // claimed-count is an integer field; the recognition refines the decimal
    // base parameter. Evidence converts INTO the recognition (that side may),
    // and the recognition proves directly into the parameter (that side must).
    const chained = await compile(
      v2Config({
        recognitions: {
          [R_LEVEL]: { label: '认定级别', refinement: null, defaultFromFieldId: 'claimed-level' },
          [R_ORDINAL]: {
            label: '认定序位',
            refinement: null,
            defaultFromFieldId: 'claimed-ordinal',
          },
          [R_BASE]: {
            label: '基础分',
            refinement: {
              type: 'string',
              format: 'qualy-decimal',
              'x-qualy-maxScale': 2,
              'x-qualy-minimum': '0',
              'x-qualy-maximum': '100',
            },
            defaultFromFieldId: 'claimed-count',
          },
        },
        bindings: {
          level: { kind: 'recognition', recognitionId: R_LEVEL },
          ordinal: { kind: 'recognition', recognitionId: R_ORDINAL },
          base: { kind: 'recognition', recognitionId: R_BASE },
        },
      }),
    )
    expect('plan' in chained).toBe(true)
    if ('plan' in chained) {
      expect(chained.plan.parameters['base']).toEqual({
        kind: 'recognition',
        recognitionId: R_BASE,
        assignment: { kind: 'direct' },
      })
      expect(chained.plan.defaultBindings[R_BASE]?.assignment).toEqual({
        kind: 'convert',
        converter: 'integer-to-decimal@1',
      })
    }
    // and an evidence field the refined recognition would not admit is refused
    const overflowingSeed = await compile(
      v2Config({
        recognitions: {
          [R_LEVEL]: { label: '认定级别', refinement: null, defaultFromFieldId: 'claimed-level' },
          [R_ORDINAL]: {
            label: '认定序位',
            refinement: { type: 'integer', minimum: 2, maximum: 8 },
            defaultFromFieldId: 'wide-ordinal',
          },
        },
      }),
    )
    expect(reasons(overflowingSeed)).toEqual([
      `scoringConfig.recognitions.${R_ORDINAL}:default-integer-range-widens`,
    ])
  })

  it('judges the merged schema - label included - as an issue, never a TypeError', async () => {
    const long = '长'.repeat(256)
    // an unlawful label over a null refinement: the parameter schema itself
    // was fine, so only the merged validation can catch it
    const bareLong = await compile(
      ordinalRefined(null) === undefined
        ? {}
        : v2Config({
            recognitions: {
              [R_LEVEL]: {
                label: '认定级别',
                refinement: null,
                defaultFromFieldId: 'claimed-level',
              },
              [R_ORDINAL]: { label: long, refinement: null, defaultFromFieldId: 'claimed-ordinal' },
            },
          }),
    )
    expect(reasons(bareLong)).toContain(
      `scoringConfig.recognitions.${R_ORDINAL}:recognition-annotation-too-long`,
    )
    const refinedLong = await compile(
      v2Config({
        recognitions: {
          [R_LEVEL]: { label: '认定级别', refinement: null, defaultFromFieldId: 'claimed-level' },
          [R_ORDINAL]: {
            label: long,
            refinement: { type: 'integer', minimum: 2, maximum: 8 },
            defaultFromFieldId: null,
          },
        },
      }),
    )
    expect(reasons(refinedLong)).toContain(
      `scoringConfig.recognitions.${R_ORDINAL}:recognition-annotation-too-long`,
    )
    // a pattern outside the dialect is caught before any kind proof
    const dialect = await compile(
      ordinalRefined({ type: 'string', minLength: 1, maxLength: 8, pattern: '(?<=a)b' }),
    )
    expect(reasons(dialect)).toContain(
      `scoringConfig.recognitions.${R_ORDINAL}:recognition-pattern-outside-dialect`,
    )
  })

  it("freezes the administrator's label over the refinement's own title", async () => {
    const outcome = await compile(
      ordinalRefined({ type: 'integer', minimum: 2, maximum: 8, title: '别的名字' }),
    )
    expect('plan' in outcome).toBe(true)
    if ('plan' in outcome) {
      expect((outcome.plan.recognitionSchemas[R_ORDINAL] as { title?: string }).title).toBe(
        '认定序位',
      )
    }
  })

  it('keeps a rename off the plan identity', async () => {
    const [a, b] = await Promise.all([
      compile(ordinalRefined({ type: 'integer', minimum: 2, maximum: 8 })),
      compile(
        v2Config({
          recognitions: {
            [R_LEVEL]: { label: '认定级别', refinement: null, defaultFromFieldId: 'claimed-level' },
            [R_ORDINAL]: {
              label: '换了个说法',
              refinement: { type: 'integer', minimum: 2, maximum: 8 },
              defaultFromFieldId: null,
            },
          },
        }),
      ),
    ])
    expect('plan' in a && 'plan' in b).toBe(true)
    if ('plan' in a && 'plan' in b) {
      expect(a.plan.planHash).toBe(b.plan.planHash)
    }
  })

  it('freezes one canonical constant for every spelling of the amount', async () => {
    const spelledAs = (value: string) =>
      v2Config({
        bindings: {
          level: { kind: 'recognition', recognitionId: R_LEVEL },
          ordinal: { kind: 'recognition', recognitionId: R_ORDINAL },
          base: { kind: 'constant', value },
        },
      })
    const outcomes = await Promise.all(
      ['3', '3.0', '3.00', '3.000'].map((v) => compile(spelledAs(v))),
    )
    for (const outcome of outcomes) {
      expect('plan' in outcome).toBe(true)
      if ('plan' in outcome) {
        expect(outcome.plan.parameters['base']).toEqual({ kind: 'constant', value: '3' })
        expect(outcome.plan.planHash).toBe(
          ('plan' in outcomes[0]! && outcomes[0].plan.planHash) || '',
        )
      }
    }
    // a spelling the amount grammar refuses is refused, not repaired
    expect(reasons(await compile(spelledAs('03.000')))).toContain(
      'scoringConfig.bindings.base:constant-format',
    )
  })

  it('refuses a version this compiler does not speak, even straight from the column', async () => {
    const alien = await compile({ ...v2Config({}), version: 3 })
    expect(reasons(alien)).toEqual(['scoringConfig.version:authoring-version-unsupported'])
    // and the strict envelope refuses a stray key instead of stripping it
    const stray = await compile({ ...v2Config({}), novel: true })
    expect(reasons(stray)).toEqual(['scoringConfig:scoring-config-shape'])
  })
})

describe('a stored-program calculator freezes its runtime identity', () => {
  const storedConfig = (program: string, over: Record<string, unknown> = {}) => ({
    version: 2,
    calculator: { ref: 'stored-test@1', config: { program, ...over } },
    aggregator: { ref: 'sum@1', config: {} },
    recognitions: {},
    bindings: {},
  })

  it('freezes the exact reference into the plan, inside its identity', async () => {
    const [a, b, c] = await Promise.all([
      compile(storedConfig('prog-alpha')),
      compile(storedConfig('prog-alpha')),
      compile(storedConfig('prog-beta')),
    ])
    expect('plan' in a && 'plan' in b && 'plan' in c).toBe(true)
    if ('plan' in a && 'plan' in b && 'plan' in c) {
      expect(a.plan.version).toBe(2)
      if (a.plan.version === 2) {
        expect(a.plan.calculator.runtimeRef).toEqual(storedRuntimeRefOf('prog-alpha'))
        expect(a.plan.valueSchemaProfileVersion).toBe(2)
        expect(a.plan.regexProfileVersion).toBe(1)
      }
      expect(a.plan.planHash).toBe(b.plan.planHash)
      // a different program is a different arithmetic, by hash
      expect(a.plan.planHash).not.toBe(c.plan.planHash)
    }
  })

  it('refuses the V1 language a home for a runtime identity, never drops it', async () => {
    const legacy = await compile({
      calculator: { ref: 'stored-test@1', config: { program: 'prog-alpha' } },
      aggregator: { ref: 'sum@1', config: {} },
    })
    expect(reasons(legacy)).toEqual([
      'scoringConfig.calculator:calculator-runtime-requires-plan-v2',
    ])
  })

  it('lets a V2 plan carry no reference at all: fixed stays welcome', async () => {
    const outcome = await compile({
      version: 2,
      calculator: { ref: 'fixed@1', config: { value: '3' } },
      aggregator: { ref: 'sum@1', config: {} },
      recognitions: {},
      bindings: {},
    })
    expect('plan' in outcome).toBe(true)
    if ('plan' in outcome && outcome.plan.version === 2) {
      expect(outcome.plan.calculator.runtimeRef).toBeUndefined()
    }
  })

  it('never writes a reference its own reader would refuse', async () => {
    const outcome = await compile(storedConfig('prog-alpha', { brokenSha: true }))
    expect(reasons(outcome)).toEqual(['scoringConfig.calculator:calculator-runtime-ref-invalid'])
  })

  it('writes what its reader certifies: the V2 plan survives the column round trip', async () => {
    const outcome = await compile(storedConfig('prog-alpha'))
    expect('plan' in outcome).toBe(true)
    if ('plan' in outcome) {
      const back = await Effect.runPromise(
        readScoringPlan({ id: 'rev-rt', scoringPlan: JSON.parse(JSON.stringify(outcome.plan)) }),
      )
      expect(back.planHash).toBe(outcome.plan.planHash)
    }
  })
})

describe('the evaluation identity: would the same values score the same', () => {
  const R_LEVEL = '01920000-0000-7000-8000-000000000201'
  const R_ORDINAL = '01920000-0000-7000-8000-000000000202'
  const gradedV2 = (over: Record<string, unknown> = {}) => ({
    version: 2,
    calculator: { ref: 'graded-test@1', config: {} },
    aggregator: { ref: 'sum@1', config: {} },
    recognitions: {
      [R_LEVEL]: { label: '级别', refinement: null, defaultFromFieldId: 'claimed-level' },
      [R_ORDINAL]: {
        label: '序位',
        refinement: { type: 'integer', minimum: 2, maximum: 8 },
        defaultFromFieldId: null,
      },
    },
    bindings: {
      level: { kind: 'recognition', recognitionId: R_LEVEL },
      ordinal: { kind: 'recognition', recognitionId: R_ORDINAL },
      base: { kind: 'constant', value: '3' },
    },
    ...over,
  })
  const planOf = async (config: unknown) => {
    const outcome = await compile(config)
    if (!('plan' in outcome)) throw new Error(`fixture did not compile: ${JSON.stringify(outcome)}`)
    return outcome.plan
  }

  it('ignores presentation and admission, and moves with the arithmetic', async () => {
    const base = await planOf(gradedV2())
    // a rename: same everything
    const renamed = await planOf(
      gradedV2({
        recognitions: {
          [R_LEVEL]: { label: '换个名', refinement: null, defaultFromFieldId: 'claimed-level' },
          [R_ORDINAL]: {
            label: '序位',
            refinement: { type: 'integer', minimum: 2, maximum: 8 },
            defaultFromFieldId: null,
          },
        },
      }),
    )
    expect(evaluationHash(renamed)).toBe(evaluationHash(base))
    // a different default seeding moves the plan identity, not the arithmetic
    const reseeded = await planOf(
      gradedV2({
        recognitions: {
          [R_LEVEL]: { label: '级别', refinement: null, defaultFromFieldId: null },
          [R_ORDINAL]: {
            label: '序位',
            refinement: { type: 'integer', minimum: 2, maximum: 8 },
            defaultFromFieldId: null,
          },
        },
      }),
    )
    expect(reseeded.planHash).not.toBe(base.planHash)
    expect(evaluationHash(reseeded)).toBe(evaluationHash(base))
    // a tighter refinement narrows what MAY be determined, not what a given
    // determination computes
    const tightened = await planOf(
      gradedV2({
        recognitions: {
          [R_LEVEL]: { label: '级别', refinement: null, defaultFromFieldId: 'claimed-level' },
          [R_ORDINAL]: {
            label: '序位',
            refinement: { type: 'integer', minimum: 3, maximum: 7 },
            defaultFromFieldId: null,
          },
        },
      }),
    )
    expect(tightened.planHash).not.toBe(base.planHash)
    expect(evaluationHash(tightened)).toBe(evaluationHash(base))
    // and what genuinely changes the arithmetic changes the identity
    const repriced = await planOf(
      gradedV2({
        bindings: {
          level: { kind: 'recognition', recognitionId: R_LEVEL },
          ordinal: { kind: 'recognition', recognitionId: R_ORDINAL },
          base: { kind: 'constant', value: '4' },
        },
      }),
    )
    expect(evaluationHash(repriced)).not.toBe(evaluationHash(base))
    const refolded = await planOf(gradedV2({ aggregator: { ref: 'max@1', config: {} } }))
    expect(evaluationHash(refolded)).not.toBe(evaluationHash(base))
  })

  it('knows what one determination is worth apart from how they are folded', async () => {
    // The narrower identity: the trial that re-runs every standing
    // determination through a candidate rule asks whether any ONE of them
    // is worth something else now. A question folding its amounts
    // differently changes nothing about that, and neither does admission.
    const base = await planOf(gradedV2())
    const refolded = await planOf(gradedV2({ aggregator: { ref: 'max@1', config: {} } }))
    expect(evaluationHash(refolded)).not.toBe(evaluationHash(base))
    expect(recognitionEvaluationHash(refolded)).toBe(recognitionEvaluationHash(base))
    const tightened = await planOf(
      gradedV2({
        recognitions: {
          [R_LEVEL]: { label: '级别', refinement: null, defaultFromFieldId: 'claimed-level' },
          [R_ORDINAL]: {
            label: '序位',
            refinement: { type: 'integer', minimum: 3, maximum: 7 },
            defaultFromFieldId: null,
          },
        },
      }),
    )
    expect(recognitionEvaluationHash(tightened)).toBe(recognitionEvaluationHash(base))
    // and what genuinely changes what a determination computes still moves it
    const repriced = await planOf(
      gradedV2({
        bindings: {
          level: { kind: 'recognition', recognitionId: R_LEVEL },
          ordinal: { kind: 'recognition', recognitionId: R_ORDINAL },
          base: { kind: 'constant', value: '4' },
        },
      }),
    )
    expect(recognitionEvaluationHash(repriced)).not.toBe(recognitionEvaluationHash(base))
  })

  it('moves with the runtime identity', async () => {
    const alpha = await planOf({
      version: 2,
      calculator: { ref: 'stored-test@1', config: { program: 'prog-alpha' } },
      aggregator: { ref: 'sum@1', config: {} },
      recognitions: {},
      bindings: {},
    })
    const beta = await planOf({
      version: 2,
      calculator: { ref: 'stored-test@1', config: { program: 'prog-beta' } },
      aggregator: { ref: 'sum@1', config: {} },
      recognitions: {},
      bindings: {},
    })
    expect(evaluationHash(alpha)).not.toBe(evaluationHash(beta))
  })

  it('reads one arithmetic across the two plan languages', async () => {
    // all-constant bindings, so no V2 recognition identity separates them:
    // the V1 plan froze "3.00" as authored, the V2 plan froze "3", and the
    // evaluation identity spells both canonically
    const constants = {
      level: { kind: 'constant', value: 'national' },
      ordinal: { kind: 'constant', value: 5 },
    }
    const v1 = await planOf({
      calculator: { ref: 'graded-test@1', config: {} },
      aggregator: { ref: 'sum@1', config: {} },
      bindings: { ...constants, base: { kind: 'constant', value: '3.00' } },
    })
    const v2 = await planOf(
      gradedV2({
        recognitions: {},
        bindings: { ...constants, base: { kind: 'constant', value: '3' } },
      }),
    )
    expect(v1.version).toBe(1)
    expect(v2.version).toBe(2)
    expect((v1.parameters['base'] as { value: string }).value).toBe('3.00')
    expect(evaluationHash(v1)).toBe(evaluationHash(v2))
  })
})

describe('what a calculator refusal carries out of the compile', () => {
  const coded: CalculatorRegistration = {
    kind: 'calculator',
    ref: 'coded-test@1',
    configSchema: Schema.Struct({}),
    bind: Effect.succeed({
      ref: 'coded-test@1',
      compile: () =>
        Effect.fail(
          new CalculatorContractError(
            'refusal',
            'the named version is unavailable',
            'coded-version-not-found',
          ),
        ),
      verify: () => Effect.void,
      prepare: () => Effect.die(new Error('never prepared')),
    }),
  }
  const mute: CalculatorRegistration = {
    kind: 'calculator',
    ref: 'mute-test@1',
    configSchema: Schema.Struct({}),
    bind: Effect.succeed({
      ref: 'mute-test@1',
      compile: () => Effect.fail(new CalculatorContractError('invariant', 'no code on this one')),
      verify: () => Effect.void,
      prepare: () => Effect.die(new Error('never prepared')),
    }),
  }
  const extended = [fixed1, coded, mute]
  const compileWith = (scoringConfig: unknown) =>
    Effect.runPromise(
      compileScoringPlan({
        definitions: testDefinitions(extended, builtinAggregators),
        compile: testRuntime(extended).compile,
        host: testHost,
        itemType: undefined,
        formConfig: {},
        scoringConfig,
        batch,
        recognitionSource: 'review',
      }),
    )

  it("carries the calculator's own code into the issue, and stays generic without one", async () => {
    const named = await compileWith({
      calculator: { ref: 'coded-test@1', config: {} },
      aggregator: { ref: 'sum@1', config: {} },
    })
    expect(reasons(named)).toEqual(['scoringConfig.calculator.config:coded-version-not-found'])
    const generic = await compileWith({
      calculator: { ref: 'mute-test@1', config: {} },
      aggregator: { ref: 'sum@1', config: {} },
    })
    expect(reasons(generic)).toEqual([
      'scoringConfig.calculator.config:calculator-contract-unavailable',
    ])
    // and the kind rides on the error itself, for the failure handling to come
    const error = new CalculatorContractError('refusal', 'why', 'code-x')
    expect(error.kind).toBe('refusal')
    expect(error.code).toBe('code-x')
  })
})
