import { Effect, Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { validateValue } from '@qualy/value-schema/validate'
import { SCORE_AMOUNT_SCHEMA } from '@qualy/value-schema/score'
import { calcParticipant } from '../src/scoring/calc.ts'
import { builtinAggregators, fixed1, scaledAmount } from '../src/scoring/builtins.ts'
import { hashCanonicalJson } from '@qualy/value-schema/hash'
import {
  carriesInto,
  compileScoringPlan,
  readScoringPlan,
  semanticPlanBody,
} from '../src/scoring/plan.ts'
import { gradedTest, testDefinitions, testHost, testRuntime } from './support/catalogs.ts'
import {
  canonicalRecognition,
  contradicted,
  judgeRecognition,
  recognitionHash,
  sameRecognition,
  seedFromEvidence,
} from '../src/scoring/recognition.ts'
import type { AggregatorDriver, BatchContext, CalculatorRegistration } from '../src/plugin.ts'

// What the scoring layer refuses.
//
// Each of these is a way a wrong answer could have reached a student's page
// looking like a right one: a saved amount the frozen output schema would
// later reject, an aggregator whose decisions land on the wrong claims, a
// stored plan from a build that is not this one, a configuration key that is
// a JavaScript prototype rather than a name.

const batch: BatchContext = { materialRange: { start: '2026-03-01', end: '2026-09-01' } }

const builtins = testDefinitions([fixed1], builtinAggregators)
const builtinRuntime = testRuntime([fixed1])

const compile = (scoringConfig: unknown) =>
  Effect.runPromise(
    compileScoringPlan({
      definitions: builtins,
      compile: builtinRuntime.compile,
      host: testHost,
      itemType: undefined,
      formConfig: {},
      scoringConfig,
      batch,
      recognitionSource: 'review',
    }),
  )

const fixedConfig = (value: string) => ({
  calculator: { ref: 'fixed@1', config: { value } },
  aggregator: { ref: 'sum@1', config: {} },
})

describe('what a fixed amount may be spelled as', () => {
  it('refuses a spelling its own answer would fail on', async () => {
    // the platform amount's grammar has no leading zeros, and the frozen
    // output schema is checked after the calculator answers - so accepting
    // "03.00" here would save a question that fails on a results page
    for (const wrong of ['03.00', '0001', '-00.50', '3.', '+3', '1e3', '99999999.99999']) {
      const outcome = await compile(fixedConfig(wrong))
      expect('issues' in outcome, wrong).toBe(true)
    }
  })

  it('accepts the spellings the platform amount admits, and executes one of them', async () => {
    for (const right of ['3', '3.0', '3.00', '-1.5', '0', '0.0001']) {
      const outcome = await compile(fixedConfig(right))
      expect('plan' in outcome, right).toBe(true)
    }
    // and two spellings of one amount are one plan: the calculator says what
    // it will execute, so a re-save spelled differently is not a new
    // arithmetic to anybody reading hashes
    const [a, b] = await Promise.all([compile(fixedConfig('3.0')), compile(fixedConfig('3.00'))])
    expect('plan' in a && 'plan' in b).toBe(true)
    if ('plan' in a && 'plan' in b) {
      expect(a.plan.planHash).toBe(b.plan.planHash)
      expect(a.plan.calculator.config).toEqual({ value: '3' })
    }
  })

  it('answers inside its own frozen output schema, for every accepted config', () => {
    // the invariant the leading-zero grammar broke: whatever a saved config
    // makes this calculator answer has to pass the schema the plan froze,
    // because that is checked after the answer comes back
    return Effect.runPromise(
      Effect.gen(function* () {
        const bound = yield* fixed1.bind
        for (const value of ['3', '3.0', '3.00', '-1.5', '0', '0.0001']) {
          const compiled = yield* bound.compile({ value }, testHost)
          const prepared = yield* bound.prepare(compiled.config, undefined, testHost)
          const answer = yield* prepared.evaluate({})
          expect(validateValue(compiled.outputSchema, answer), value).toEqual([])
        }
      }),
    )
  })
})

describe('what a stored plan must be before it runs', () => {
  const planOf = async () => {
    const outcome = await compile(fixedConfig('3'))
    if (!('plan' in outcome)) throw new Error('fixture: the plan did not compile')
    return outcome.plan
  }

  const read = (scoringPlan: unknown) =>
    Effect.runPromiseExit(readScoringPlan({ id: 'rev-1', scoringPlan }))

  it('reads back a plan this build wrote', async () => {
    const plan = await planOf()
    const back = await read(JSON.parse(JSON.stringify(plan)))
    expect(Exit.isSuccess(back)).toBe(true)
  })

  it('refuses a version it does not execute', async () => {
    // a newer server writing a shape this one does not know must stop it,
    // not have it scored through during a rolling deployment
    const plan = await planOf()
    const back = await read({ ...JSON.parse(JSON.stringify(plan)), version: 77 })
    expect(Exit.isFailure(back)).toBe(true)
  })

  it('refuses a body that disagrees with the hash it was stored with', async () => {
    const plan = await planOf()
    const tampered = JSON.parse(JSON.stringify(plan)) as {
      calculator: { config: { value: string } }
    }
    tampered.calculator.config.value = '9999'
    expect(Exit.isFailure(await read(tampered))).toBe(true)
  })

  it("refuses a converter outside this build's vocabulary, at the read", async () => {
    // integrity is not the question - the forged hash below is CORRECT for
    // its body. A newer build can legitimately store a converter this one
    // does not implement, and carrying it to a null lookup would fail as
    // the student's input at scoring time; the reader is where it stops.
    const plan = await planOf()
    const { planHash: _dropped, ...body } = JSON.parse(JSON.stringify(plan)) as typeof plan
    const withForeignConverter = {
      ...body,
      parameters: {
        level: {
          kind: 'recognition',
          recognitionId: 'rec-level',
          assignment: { kind: 'convert', converter: 'string-to-decimal@9' },
        },
      },
    }
    const forged = {
      ...withForeignConverter,
      planHash: hashCanonicalJson(semanticPlanBody(withForeignConverter as never)),
    }
    expect(Exit.isFailure(await read(forged))).toBe(true)

    // and the one converter this build implements still reads back
    const withKnownConverter = {
      ...body,
      parameters: {
        level: {
          kind: 'recognition',
          recognitionId: 'rec-level',
          assignment: { kind: 'convert', converter: 'integer-to-decimal@1' },
        },
      },
    }
    const legal = {
      ...withKnownConverter,
      planHash: hashCanonicalJson(semanticPlanBody(withKnownConverter as never)),
    }
    expect(Exit.isSuccess(await read(legal))).toBe(true)
  })

  it("refuses a schema outside this build's value profile, at the read", async () => {
    // same shape of forgery: hash-consistent, structurally sound, but the
    // input schema speaks a profile feature this build has never heard of -
    // ajv would judge values while silently ignoring it
    const plan = await planOf()
    const { planHash: _dropped, ...body } = JSON.parse(JSON.stringify(plan)) as typeof plan
    // an integer with no explicit bounds: canonicalizes fine, but the
    // profile of THIS build requires stated safe bounds and refuses it
    const withForeignSchema = {
      ...body,
      inputSchema: {
        type: 'object',
        properties: { a: { type: 'integer', minimum: 0 } },
        required: ['a'],
        additionalProperties: false,
      },
    }
    const forged = {
      ...withForeignSchema,
      planHash: hashCanonicalJson(semanticPlanBody(withForeignSchema as never)),
    }
    const outcome = await read(forged)
    expect(Exit.isFailure(outcome)).toBe(true)
  })

  it('refuses a shape that is not a plan, and a missing one', async () => {
    expect(Exit.isFailure(await read({ version: 1, parameters: 'oops' }))).toBe(true)
    expect(Exit.isFailure(await read(null))).toBe(true)
    expect(Exit.isFailure(await read([1, 2, 3]))).toBe(true)
  })
})

describe('what the account refuses to total', () => {
  it('names a rootless loop instead of reading zero', () => {
    // the api cannot produce this shape (self-parent, cycles and multiple
    // roots are all refused); hand-broken rows must still be an error, not
    // a quiet zero - a loop with no root never enters the root walk at all
    const loop = [
      { id: 'a', parentGroupId: 'b', name: 'a', cap: null, floor: null, sortOrder: 0 },
      { id: 'b', parentGroupId: 'a', name: 'b', cap: null, floor: null, sortOrder: 1 },
    ]
    expect(() =>
      calcParticipant({ aggregators: new Map() }, { groups: loop, items: [], entries: [] }),
    ).toThrowError(/unreachable/)
  })
})

describe('how an aggregator answer reaches the account', () => {
  const item = {
    id: 'i',
    title: 'i',
    scoreGroupId: 'g',
    sortOrder: 0,
    createdAt: 1,
    calculatorRef: 'fixed@1',
    standing: 'scored' as const,
  }
  const entries = [
    {
      id: 'a',
      itemId: 'i',
      revisionId: 'r-a',
      createdAt: 1,
      standing: 'counted' as const,
      recognitionId: 'rec-a',
      amount: scaledAmount('1.00'),
    },
    {
      id: 'b',
      itemId: 'i',
      revisionId: 'r-b',
      createdAt: 2,
      standing: 'counted' as const,
      recognitionId: 'rec-b',
      amount: scaledAmount('3.00'),
    },
  ]

  const account = (aggregate: AggregatorDriver['aggregate']) =>
    calcParticipant(
      {
        aggregators: new Map<string, AggregatorDriver>([
          [
            'test@1',
            { kind: 'aggregator', ref: 'test@1', configSchema: Schema.Struct({}), aggregate },
          ],
        ]),
      },
      {
        groups: [{ id: 'g', parentGroupId: null, name: 'g', cap: null, floor: null, sortOrder: 0 }],
        items: [{ ...item, aggregator: { ref: 'test@1', config: {} } }],
        entries,
      },
    )

  it('matches every decision to the claim it names, whatever order they arrive in', () => {
    // an aggregator is free to sort its own output - "the highest first" is
    // a natural way to write one - and the account must still explain each
    // claim with the decision made about that claim
    const result = account((_config, given) => ({
      total: 0n,
      entries: [...given]
        .sort((one, two) => (two.amount > one.amount ? 1 : -1))
        .map((one, index) => ({
          entryId: one.entryId,
          included: index === 0,
          effectiveAmount: index === 0 ? one.amount : 0n,
          ...(index === 0 ? {} : { reason: 'not-selected' as const }),
        })),
    }))
    expect(result.lines.map((line) => [line.lineId, line.kind, line.value])).toEqual([
      ['entry:a', 'entry-not-counted', '0.00'],
      ['entry:b', 'entry', '3.00'],
    ])
  })

  it('refuses an answer that drops, repeats or invents a claim', () => {
    const dropped = () =>
      account((_config, given) => ({
        total: 0n,
        entries: given.slice(0, 1).map((one) => ({
          entryId: one.entryId,
          included: true,
          effectiveAmount: one.amount,
        })),
      }))
    expect(dropped).toThrow(/answered for 1 entries of 2/)

    const repeated = () =>
      account((_config, given) => ({
        total: 0n,
        entries: given.map(() => ({
          entryId: 'a',
          included: true,
          effectiveAmount: 0n,
        })),
      }))
    expect(repeated).toThrow(/answered twice for entry a/)

    const invented = () =>
      account((_config, given) => ({
        total: 0n,
        entries: given.map((one, index) => ({
          entryId: index === 0 ? 'someone-else' : one.entryId,
          included: true,
          effectiveAmount: 0n,
        })),
      }))
    expect(invented).toThrow(/did not answer for entry a/)
  })
})

describe('what a configuration key may be', () => {
  const graded: CalculatorRegistration = {
    kind: 'calculator',
    ref: 'proto-test@1',
    configSchema: Schema.Struct({}),
    bind: Effect.succeed({
      ref: 'proto-test@1',
      compile: (config) =>
        Effect.succeed({
          config,
          inputSchema: normalizeInputSchema({
            type: 'object',
            properties: { level: { type: 'string', enum: ['a', 'b'] } },
            required: ['level'],
            additionalProperties: false,
          }),
          outputSchema: normalizeAtomicSchema(SCORE_AMOUNT_SCHEMA),
          contractHash: 'test:proto',
        }),
      verify: () => Effect.void,
      prepare: () => Effect.succeed({ evaluate: () => Effect.succeed('1.00') }),
    }),
  }

  it('treats a prototype name as a name, not as JavaScript', async () => {
    // scoringConfig is persisted configuration written by administrators: a
    // recognition called `__proto__` or `constructor` must be a key like any
    // other, never an assignment nobody can see or a lookup that finds
    // something nobody wrote
    for (const hostile of ['__proto__', 'constructor', 'toString']) {
      const outcome = await Effect.runPromise(
        compileScoringPlan({
          definitions: testDefinitions([graded], builtinAggregators),
          compile: testRuntime([graded]).compile,
          host: testHost,
          itemType: undefined,
          formConfig: {},
          scoringConfig: {
            calculator: { ref: graded.ref, config: {} },
            aggregator: { ref: 'sum@1', config: {} },
            recognitions: { [hostile]: { defaultFromFieldId: null } },
            bindings: { level: { kind: 'recognition', recognitionId: hostile } },
          },
          batch,
          recognitionSource: 'review',
        }),
      )
      expect('plan' in outcome, hostile).toBe(true)
      if (!('plan' in outcome)) continue
      // it is a real key of the frozen contract, and judging reads it as one
      expect(Object.keys(outcome.plan.recognitionSchemas)).toEqual([hostile])
      expect(judgeRecognition(outcome.plan.recognitionSchemas, {})).toEqual([
        { recognitionId: hostile, reason: 'missing' },
      ])
      expect(judgeRecognition(outcome.plan.recognitionSchemas, { [hostile]: 'a' })).toEqual([])
      // and an empty determination does not accidentally satisfy it by
      // finding a prototype member of the candidate object
      expect(judgeRecognition(outcome.plan.recognitionSchemas, Object.create(null))).toEqual([
        { recognitionId: hostile, reason: 'missing' },
      ])
    }
  })
})

describe('what makes two determinations the same one', () => {
  const schemas = {
    'rec-score': normalizeAtomicSchema({
      type: 'string',
      format: 'qualy-decimal',
      'x-qualy-maxScale': 4,
    }),
    'rec-level': normalizeAtomicSchema({ type: 'string', enum: ['a', 'b'] }),
  }

  it('reads one number written two ways as one determination', () => {
    // a schema fixes what a value IS; text fixes only how somebody typed
    // it. Without this, one reviewer's "3.0" and another's "3.00" are two
    // proposals a sitting cannot reconcile, and a second stage writing the
    // same number differently reads as a change that needs explaining
    const a = canonicalRecognition(schemas, { 'rec-score': '3.0', 'rec-level': 'a' })
    const b = canonicalRecognition(schemas, { 'rec-score': '3.00', 'rec-level': 'a' })
    expect(recognitionHash(a)).toBe(recognitionHash(b))
    expect(sameRecognition(a, b)).toBe(true)
    expect(contradicted(a, b)).toEqual([])
    // and it is the canonical spelling that gets stored, not whichever
    // arrived first
    expect(a).toEqual({ 'rec-score': '3', 'rec-level': 'a' })
  })

  it('still tells two different numbers apart', () => {
    const a = canonicalRecognition(schemas, { 'rec-score': '3.0', 'rec-level': 'a' })
    const b = canonicalRecognition(schemas, { 'rec-score': '3.01', 'rec-level': 'a' })
    expect(recognitionHash(a)).not.toBe(recognitionHash(b))
    expect(contradicted(a, b)).toEqual(['rec-score'])
  })

  it('counts filling in a blank as making a determination, not changing one', () => {
    // the seed of a round whose question has a reviewer-only fact
    const seed = { 'rec-level': 'a' }
    const filled = { 'rec-level': 'a', 'rec-score': '3' }
    expect(contradicted(seed, filled)).toEqual([])
    expect(contradicted(seed, { 'rec-level': 'b', 'rec-score': '3' })).toEqual(['rec-level'])
  })
})

describe('where a recognition default reads from', () => {
  const plannedWith = async (over: Partial<Parameters<typeof compileScoringPlan>[0]>) => {
    const outcome = await Effect.runPromise(
      compileScoringPlan({
        definitions: testDefinitions([gradedTest], builtinAggregators),
        compile: testRuntime([gradedTest]).compile,
        host: testHost,
        itemType: {
          id: 'evidence',
          configSchema: Schema.Struct({}),
          decodePayload: (_config, payload) => Effect.succeed(payload),
          attachmentRefs: () => [],
          // identity and address deliberately apart: the field kept its id
          // while its key moved, which is exactly what production forms do
          bindableFields: () => [
            {
              fieldId: 'claimed-level',
              payloadKey: 'claimed-level-slot',
              schema: { type: 'string', enum: ['national', 'provincial'] },
              always: true,
            },
          ],
          interaction: 'entry',
          scoring: { calculator: gradedTest.ref, aggregator: 'sum@1' },
        },
        formConfig: {},
        scoringConfig: {
          calculator: { ref: gradedTest.ref, config: {} },
          aggregator: { ref: 'sum@1', config: {} },
          recognitions: { 'rec-level': { defaultFromFieldId: 'claimed-level' } },
          bindings: { level: { kind: 'recognition', recognitionId: 'rec-level' } },
        },
        batch,
        recognitionSource: 'review',
        ...over,
      }),
    )
    if (!('plan' in outcome)) throw new Error('fixture: the plan did not compile')
    return outcome.plan
  }

  it('seeds from the payload address, never from the identity', async () => {
    const plan = await plannedWith({})
    // the answer sits where this revision's key says it does
    expect(seedFromEvidence(plan, { 'claimed-level-slot': 'provincial' })).toEqual({
      'rec-level': 'provincial',
    })
    // a value filed under the IDENTITY is a value nowhere: the identity is
    // how revisions recognise each other, not where payloads keep answers
    expect(seedFromEvidence(plan, { 'claimed-level': 'provincial' })).toEqual({})
  })

  it('still reads plans frozen before the two were told apart', async () => {
    const plan = await plannedWith({})
    // an old plan froze only the fieldId, and for it the id WAS the address
    const legacy = {
      ...plan,
      defaultBindings: Object.fromEntries(
        Object.entries(plan.defaultBindings).map(([id, binding]) => [
          id,
          { fieldId: binding.fieldId, assignment: binding.assignment },
        ]),
      ),
    } as typeof plan
    expect(seedFromEvidence(legacy, { 'claimed-level': 'provincial' })).toEqual({
      'rec-level': 'provincial',
    })
  })

  it('freezes the recognition label as the schema title, off the hash', async () => {
    const named = await plannedWith({
      scoringConfig: {
        calculator: { ref: gradedTest.ref, config: {} },
        aggregator: { ref: 'sum@1', config: {} },
        recognitions: {
          'rec-level': { label: '认定赛事级别', defaultFromFieldId: 'claimed-level' },
        },
        bindings: { level: { kind: 'recognition', recognitionId: 'rec-level' } },
      },
    })
    const renamed = await plannedWith({
      scoringConfig: {
        calculator: { ref: gradedTest.ref, config: {} },
        aggregator: { ref: 'sum@1', config: {} },
        recognitions: {
          'rec-level': { label: '认定竞赛级别', defaultFromFieldId: 'claimed-level' },
        },
        bindings: { level: { kind: 'recognition', recognitionId: 'rec-level' } },
      },
    })
    // the label is presentation, carried by the annotation layer the
    // semantic body strips: what reviewers are asked never changes because
    // the question was reworded
    expect(named.recognitionSchemas['rec-level']!.title).toBe('认定赛事级别')
    expect(renamed.recognitionSchemas['rec-level']!.title).toBe('认定竞赛级别')
    expect(named.planHash).toBe(renamed.planHash)
  })
})

describe('what an open round may still produce, under a new plan', () => {
  const integer = (minimum: number, maximum: number) =>
    normalizeAtomicSchema({ type: 'integer', minimum, maximum })
  const choice = (...values: string[]) => normalizeAtomicSchema({ type: 'string', enum: values })

  it('carries only where every possible determination stays readable', () => {
    // same window: everything the old contract admits, the new one admits
    expect(carriesInto({ a: integer(1, 100) }, { a: integer(1, 100) })).toBe(true)
    // the round may determine 50; the new plan cannot read it
    expect(carriesInto({ a: integer(1, 100) }, { a: integer(1, 10) })).toBe(false)
    // a choice losing a value strands whoever was determined as it
    expect(carriesInto({ a: choice('national', 'provincial') }, { a: choice('provincial') })).toBe(
      false,
    )
    // widening never strands
    expect(carriesInto({ a: choice('provincial') }, { a: choice('national', 'provincial') })).toBe(
      true,
    )
    // renaming the words is presentation: the values are the identity
    expect(
      carriesInto(
        {
          a: normalizeAtomicSchema({
            type: 'string',
            enum: ['national'],
            'x-qualy-enumLabels': { national: '国家级' },
          }),
        },
        {
          a: normalizeAtomicSchema({
            type: 'string',
            enum: ['national'],
            'x-qualy-enumLabels': { national: '全国级' },
          }),
        },
      ),
    ).toBe(true)
    // a recognition added is as fatal as one removed: the old contract will
    // never fill it, and the determination reaches scoring incomplete
    expect(carriesInto({ a: integer(1, 5) }, { a: integer(1, 5), b: integer(1, 5) })).toBe(false)
    expect(carriesInto({ a: integer(1, 5), b: integer(1, 5) }, { a: integer(1, 5) })).toBe(false)
  })
})
