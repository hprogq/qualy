import { Effect, Layer, Schema } from 'effect'
import { DEFAULT_LIMITS, StorageConfig } from '@qualy/plugin-storage/server'
import { registryLayer } from '@qualy/plugin-storage/server/registry'
import { serviceLayer as storageOnlyLayer } from '@qualy/plugin-storage/server/service'
import { backendLayer, memoryBackend, type MemoryBackend } from '@qualy/plugin-storage/testkit'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import {
  ItemPayloadInvalid,
  ItemTypeCatalog,
  ScoringCatalog,
  type CalculatorDriver,
  type ItemTypeDriver,
} from '../../src/plugin.ts'
import type { AtomicSchema } from '@qualy/value-schema'
import { builtinScoringDrivers } from '../../src/scoring/builtins.ts'
import { constantDriver } from '../../src/item/constant.ts'
import { declarationDriver } from '../../src/item/declaration.ts'

// The two prepare-phase catalogs, as a suite provides them: the built-in
// scoring references plus one deliberately simple item-type driver.
//
// The driver is not the evidence plugin's. Core's suites are about what core
// does with a driver's answers, so this one is as small as an answer can be:
// its config names required keys, its decode refuses a payload missing one.
// That is exactly enough to watch the compatibility trial refuse a config
// change that would strand live entries.

const LEVEL: AtomicSchema = { type: 'string', enum: ['national', 'provincial'] }

export const testItemType: ItemTypeDriver = {
  id: 'evidence',
  configSchema: Schema.Struct({
    required: Schema.optional(Schema.Array(Schema.String)),
    // a stand-in for evidence's date windows: the config claims it needs
    // days from this date on, and the range sweep must notice when the
    // round no longer has any
    validFrom: Schema.optional(Schema.String),
    // a stand-in for an attachment field: payload.files cites ids under
    // these constraints
    files: Schema.optional(
      Schema.Struct({
        maxFileBytes: Schema.optional(Schema.Number),
        accept: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  }),
  configIssues: (config, batch) => {
    const from = (config as { validFrom?: string }).validFrom
    return from !== undefined && from >= batch.materialRange.end
      ? [{ path: 'formConfig.validFrom', reason: 'date-window-empty' }]
      : []
  },
  decodePayload: (config, payload) =>
    Effect.suspend(() => {
      const required = ((config as { required?: readonly string[] }).required ?? []).filter(
        (key) =>
          typeof payload !== 'object' ||
          payload === null ||
          !(key in (payload as Record<string, unknown>)),
      )
      return required.length === 0
        ? Effect.succeed(payload)
        : Effect.fail(
            new ItemPayloadInvalid(required.map((field) => ({ field, reason: 'required' }))),
          )
    }),
  attachmentRefs: (config, payload) => {
    const rules = (config as { files?: { maxFileBytes?: number; accept?: readonly string[] } })
      .files
    const cited = (payload as { files?: readonly string[] } | null)?.files ?? []
    return cited.map((attachmentId) => ({
      field: 'files',
      attachmentId,
      ...(rules?.accept !== undefined ? { accept: rules.accept } : {}),
      ...(rules?.maxFileBytes !== undefined ? { maxFileBytes: rules.maxFileBytes } : {}),
    }))
  },
  // what a reviewer's determination may be seeded from: the level the
  // student claimed. Evidence will offer its own fields; this one stands in
  // for the shape of that answer.
  bindableFields: () => [{ fieldId: 'claimed-level', schema: LEVEL, always: true }],
  interaction: 'entry',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
}

/**
 * A calculator whose answer depends on something a reviewer decides.
 *
 * Production has one calculator that reads nothing, so a suite built only on
 * fixed@1 cannot tell "the determination was carried forward" from "the
 * determination was re-read off the student's claim" - both look like the
 * empty object. This one pays a national award more than a provincial one,
 * which makes the difference visible in a number.
 */
export const gradedTest: CalculatorDriver = {
  kind: 'calculator',
  ref: 'graded-test@1',
  configSchema: Schema.Struct({}),
  compile: (config) =>
    Effect.succeed({
      config,
      inputSchema: normalizeInputSchema({
        type: 'object',
        properties: { level: LEVEL },
        required: ['level'],
        additionalProperties: false,
      }),
      outputSchema: normalizeAtomicSchema({
        type: 'string',
        format: 'qualy-decimal',
        'x-qualy-maxScale': 2,
        'x-qualy-minimum': '-99999999.99',
        'x-qualy-maximum': '99999999.99',
      }),
      contractHash: 'test:graded',
    }),
  evaluate: (_config, input) =>
    Effect.succeed(input['level'] === 'national' ? '10.00' : '4.00'),
}

/**
 * A calculator with two facts: one the filing seeds, one only a reviewer can
 * make. That is the shape that tells "filling in" apart from "changing".
 */
export const twoFactTest: CalculatorDriver = {
  kind: 'calculator',
  ref: 'two-fact-test@1',
  configSchema: Schema.Struct({}),
  compile: (config) =>
    Effect.succeed({
      config,
      inputSchema: normalizeInputSchema({
        type: 'object',
        properties: { level: LEVEL, ordinal: { type: 'integer', minimum: 1, maximum: 10 } },
        required: ['level', 'ordinal'],
        additionalProperties: false,
      }),
      outputSchema: normalizeAtomicSchema({
        type: 'string',
        format: 'qualy-decimal',
        'x-qualy-maxScale': 2,
        'x-qualy-minimum': '-99999999.99',
        'x-qualy-maximum': '99999999.99',
      }),
      contractHash: 'test:two-fact',
    }),
  evaluate: (_config, input) =>
    Effect.succeed(input['level'] === 'national' ? '10.00' : '4.00'),
}

export const twoFactScoring = {
  calculator: { ref: twoFactTest.ref, config: {} },
  aggregator: { ref: 'sum@1', config: {} },
  recognitions: {
    'rec-level': { defaultFromFieldId: 'claimed-level' },
    // no default: only a reviewer determines it
    'rec-ordinal': { defaultFromFieldId: null },
  },
  bindings: {
    level: { kind: 'recognition' as const, recognitionId: 'rec-level' },
    ordinal: { kind: 'recognition' as const, recognitionId: 'rec-ordinal' },
  },
}

/** the scoring configuration that puts a determination in front of a score */
export const gradedScoring = {
  calculator: { ref: gradedTest.ref, config: {} },
  aggregator: { ref: 'sum@1', config: {} },
  recognitions: { 'rec-level': { defaultFromFieldId: 'claimed-level' } },
  bindings: { level: { kind: 'recognition' as const, recognitionId: 'rec-level' } },
}

/**
 * Storage as a suite provides it: the service over a memory backend, no
 * sweeper, no barrier. The backend is returned so a test can plant objects
 * the way a browser upload would have.
 */
export const storageForTest = (backend: MemoryBackend = memoryBackend()) =>
  storageOnlyLayer.pipe(
    Layer.provideMerge(backendLayer(backend)),
    Layer.provideMerge(registryLayer),
    Layer.provideMerge(
      Layer.succeed(StorageConfig, { defaultBackend: backend.code, limits: DEFAULT_LIMITS }),
    ),
  )

export const catalogLayers = Layer.mergeAll(
  // the granted kind is core's own; the suites exercise it as shipped
  Layer.succeed(
    ItemTypeCatalog,
    new Map([
      [testItemType.id, testItemType],
      [constantDriver.id, constantDriver],
      [declarationDriver.id, declarationDriver],
    ]),
  ),
  Layer.succeed(ScoringCatalog, {
    calculators: new Map([
      ...builtinScoringDrivers
        .filter((driver) => driver.kind === 'calculator')
        .map((driver) => [driver.ref, driver] as const),
      [gradedTest.ref, gradedTest] as const,
      [twoFactTest.ref, twoFactTest] as const,
    ]),
    aggregators: new Map(
      builtinScoringDrivers
        .filter((driver) => driver.kind === 'aggregator')
        .map((driver) => [driver.ref, driver]),
    ),
  }),
)
