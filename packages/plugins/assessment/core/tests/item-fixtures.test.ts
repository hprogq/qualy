import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { evidenceDriver } from '@qualy/plugin-assessment-evidence/driver'
import { validateItemConfig } from '../src/item/config.ts'
import { builtinAggregators, builtinCalculators } from '../src/scoring/builtins.ts'
import { testDefinitions, testHost, testRuntime } from './support/catalogs.ts'
import { compileScoringPlan } from '../src/scoring/plan.ts'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { SCORE_AMOUNT_SCHEMA } from '@qualy/value-schema/score'
import type { CalculatorRegistration } from '../src/plugin.ts'
import { Schema } from 'effect'

// The first two real items the product ships, run through the same
// validation the configuration api runs - so "the design's examples are
// expressible" is a test rather than a hope. The real driver, the real
// scoring references, and not one line of stubbed machinery.

const catalogs = {
  itemTypes: new Map([[evidenceDriver.id, evidenceDriver]]),
  ...testDefinitions([...builtinCalculators], builtinAggregators),
}

describe('the first two real configurations', () => {
  it('expresses discharged-veteran +3: one attachment, one review stage', () => {
    const issues = Effect.runSync(
      validateItemConfig(catalogs, 'evidence', {
        entrySource: 'student',
        formConfig: {
          fields: [
            {
              key: 'discharge-certificate',
              type: 'attachment',
              label: '退役证明',
              required: true,
              maxCount: 1,
            },
          ],
        },
        scoringConfig: {
          calculator: { ref: 'fixed@1', config: { value: '3.00' } },
          aggregator: { ref: 'sum@1', config: {} },
        },
        reviewPolicy: {
          normal: {
            stages: [
              {
                id: 's1',
                selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [randomUUID()] },
                quorum: { type: 'any' },
              },
            ],
          },
          escalation: { stages: [] },
        },
      }),
    )
    expect(issues).toEqual([])
  })

  it('expresses an administrative -1: recorded with its basis, chain held for appeals', () => {
    const issues = Effect.runSync(
      validateItemConfig(catalogs, 'evidence', {
        entrySource: 'administrative',
        formConfig: {
          fields: [
            { key: 'basis', type: 'text', label: '依据（文号）', required: true },
            { key: 'document', type: 'attachment', label: '文件', maxCount: 1 },
          ],
        },
        scoringConfig: {
          calculator: { ref: 'fixed@1', config: { value: '-1.00' } },
          aggregator: { ref: 'sum@1', config: {} },
        },
        reviewPolicy: {
          normal: {
            stages: [
              {
                id: 's1',
                selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [randomUUID()] },
                quorum: { type: 'any' },
              },
            ],
          },
          escalation: { stages: [] },
        },
      }),
    )
    expect(issues).toEqual([])
  })

  it('still reads a veteran filing the way the form promised', () => {
    const attachment = randomUUID()
    const decoded = Effect.runSync(
      evidenceDriver.decodePayload(
        {
          fields: [
            {
              key: 'discharge-certificate',
              type: 'attachment',
              label: '退役证明',
              required: true,
              maxCount: 1,
            },
          ],
        },
        { 'discharge-certificate': [attachment] },
        { materialRange: { start: '2026-03-01', end: '2026-09-01' } },
      ),
    )
    expect(decoded).toEqual({ 'discharge-certificate': [attachment] })
  })
})

describe('the real driver feeding the real compiler', () => {
  /** a calculator asking for a decimal and a choice, so both proofs run */
  const typedTest: CalculatorRegistration = {
    kind: 'calculator',
    ref: 'typed-test@1',
    configSchema: Schema.Struct({}),
    bind: Effect.succeed({
      ref: 'typed-test@1',
      compile: (config) =>
        Effect.succeed({
          config,
          inputSchema: normalizeInputSchema({
            type: 'object',
            properties: {
              hours: { type: 'string', format: 'qualy-decimal', 'x-qualy-maxScale': 2 },
              level: { type: 'string', enum: ['national', 'provincial'] },
            },
            required: ['hours', 'level'],
            additionalProperties: false,
          }),
          outputSchema: normalizeAtomicSchema(SCORE_AMOUNT_SCHEMA),
          contractHash: 'test:typed',
        }),
      verify: () => Effect.void,
      prepare: () => Effect.succeed({ evaluate: () => Effect.succeed('1.00') }),
    }),
  }

  const compile = (formConfig: unknown, scoringConfig: unknown, source: 'review' | 'automatic') =>
    Effect.runPromise(
      compileScoringPlan({
        definitions: testDefinitions([typedTest], builtinAggregators),
        compile: testRuntime([typedTest]).compile,
        host: testHost,
        itemType: evidenceDriver,
        formConfig,
        scoringConfig,
        batch: { materialRange: { start: '2026-03-01', end: '2026-09-01' } },
        recognitionSource: source,
      }),
    )

  it('proves an evidence integer into a decimal recognition through the named converter', async () => {
    const outcome = await compile(
      {
        fields: [
          {
            id: 'won-hours',
            key: 'won-hours-slot',
            type: 'integer',
            label: '时长',
            required: true,
            min: 0,
            max: 100,
          },
        ],
      },
      {
        calculator: { ref: typedTest.ref, config: {} },
        aggregator: { ref: 'sum@1', config: {} },
        recognitions: { 'rec-hours': { defaultFromFieldId: 'won-hours' } },
        bindings: {
          hours: { kind: 'recognition', recognitionId: 'rec-hours' },
          level: { kind: 'constant', value: 'national' },
        },
      },
      'review',
    )
    expect('plan' in outcome).toBe(true)
    if (!('plan' in outcome)) return
    // the widening is recorded by name at compile time, never inferred at
    // evaluation - and the frozen address is the payload key, not the id
    expect(outcome.plan.defaultBindings['rec-hours']).toEqual({
      fieldId: 'won-hours',
      payloadKey: 'won-hours-slot',
      assignment: { kind: 'convert', converter: 'integer-to-decimal@1' },
    })
  })

  it('refuses to let an automatic question lean on a field a filing may omit', async () => {
    const outcome = await compile(
      {
        fields: [
          {
            key: 'level',
            type: 'choice',
            label: '级别',
            options: [
              { value: 'national', label: '国家级' },
              { value: 'provincial', label: '省部级' },
            ],
          },
        ],
      },
      {
        calculator: { ref: typedTest.ref, config: {} },
        aggregator: { ref: 'sum@1', config: {} },
        recognitions: { 'rec-level': { defaultFromFieldId: 'level' } },
        bindings: {
          level: { kind: 'recognition', recognitionId: 'rec-level' },
          hours: { kind: 'constant', value: '1' },
        },
      },
      'automatic',
    )
    expect('issues' in outcome).toBe(true)
    if (!('issues' in outcome)) return
    expect(outcome.issues.map((issue) => `${issue.path}:${issue.reason}`)).toContain(
      'scoringConfig.recognitions.rec-level:default-field-not-guaranteed',
    )
  })
})
