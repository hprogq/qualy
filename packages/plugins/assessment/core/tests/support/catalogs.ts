import { createHash } from 'node:crypto'
import { Effect, Layer, Schema } from 'effect'
import { DEFAULT_LIMITS, StorageConfig } from '@qualy/plugin-storage/server'
import { registryLayer } from '@qualy/plugin-storage/server/registry'
import { serviceLayer as storageOnlyLayer } from '@qualy/plugin-storage/server/service'
import { backendLayer, memoryBackend, type MemoryBackend } from '@qualy/plugin-storage/testkit'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { SCORE_AMOUNT_SCHEMA } from '@qualy/value-schema/score'
import type { Contributed, ProvideExtension } from '@qualy/plugin-kit'
import {
  CalculatorRuntimeError,
  ItemPayloadInvalid,
  ItemTypeCatalog,
  Scoring,
  type AggregatorDriver,
  type CalculatorCompileContext,
  type CalculatorHostContext,
  type CalculatorRegistration,
  type ItemTypeDriver,
  type FrozenCalculatorContract,
  type ScoringDefinition,
  type ScoringDefinitionCatalog,
} from '../../src/plugin.ts'
import type { AtomicSchema } from '@qualy/value-schema'
import { builtinAggregators, builtinCalculators } from '../../src/scoring/builtins.ts'
import { scoringRuntimeProvider } from '../../src/scoring/runtime-provider.ts'
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
    // a declared kind marker: the suites' stand-in for a field's type, so
    // the transition channel has something to hold constant
    kind: Schema.optional(Schema.String),
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
  // the mini form of the real drivers' rule - an identity may not change
  // its value domain across revisions; the suites use it to prove core
  // hands every update's transition to the driver
  transitionIssues: (previous, next) => {
    const kindOf = (config: unknown) => (config as { kind?: string } | null | undefined)?.kind
    const before = kindOf(previous)
    const after = kindOf(next)
    return before !== undefined && after !== undefined && before !== after
      ? [{ path: 'formConfig.kind', reason: 'kind-change-requires-new-field' }]
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
  // identity and address deliberately differ: the suites must prove the
  // seed reads the ADDRESS, because production forms rename keys while ids
  // stay put
  bindableFields: () => [
    { fieldId: 'claimed-level', payloadKey: 'claimed-level-slot', schema: LEVEL, always: true },
  ],
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
const testAmount = normalizeAtomicSchema({
  type: 'string',
  format: 'qualy-decimal',
  'x-qualy-maxScale': 2,
  'x-qualy-minimum': '-99999999.99',
  'x-qualy-maximum': '99999999.99',
})

/** a service-free registration: bind succeeds at once, prepare closes over nothing */
const testCalculator = (spec: {
  readonly ref: string
  readonly contractHash: string
  readonly properties: Record<string, unknown>
  readonly required: readonly string[]
}): CalculatorRegistration => ({
  kind: 'calculator',
  ref: spec.ref,
  configSchema: Schema.Struct({}),
  bind: Effect.succeed({
    ref: spec.ref,
    compile: (config) =>
      Effect.succeed({
        config,
        inputSchema: normalizeInputSchema({
          type: 'object',
          properties: spec.properties as never,
          required: [...spec.required],
          additionalProperties: false,
        }),
        outputSchema: testAmount,
        contractHash: spec.contractHash,
      }),
    verify: () => Effect.void,
    prepare: () =>
      Effect.succeed({
        evaluate: (input: Record<string, unknown>) =>
          Effect.succeed(input['level'] === 'national' ? '10.00' : '4.00'),
      }),
  }),
})

export const gradedTest: CalculatorRegistration = testCalculator({
  ref: 'graded-test@1',
  contractHash: 'test:graded',
  properties: { level: LEVEL },
  required: ['level'],
})

/**
 * A calculator with two facts: one the filing seeds, one only a reviewer can
 * make. That is the shape that tells "filling in" apart from "changing".
 */
export const twoFactTest: CalculatorRegistration = testCalculator({
  ref: 'two-fact-test@1',
  contractHash: 'test:two-fact',
  properties: { level: LEVEL, ordinal: { type: 'integer', minimum: 1, maximum: 10 } },
  required: ['level', 'ordinal'],
})

/**
 * The two facts again, with a tighter window on the ordinal. Swapping a
 * question between this and twoFactTest is how a suite narrows or widens a
 * typed determination without touching anything else.
 */
export const narrowFactTest: CalculatorRegistration = testCalculator({
  ref: 'narrow-fact-test@1',
  contractHash: 'test:narrow-fact',
  properties: { level: LEVEL, ordinal: { type: 'integer', minimum: 1, maximum: 5 } },
  required: ['level', 'ordinal'],
})

/**
 * A stored-program stand-in: compile freezes a runtime identity derived from
 * its config, and verify/prepare accept nothing but the exact frozen fact -
 * reference, contract and profiles alike. This is the shape formula@1 will
 * take; the suite proves the protocol without pulling Formula into Core.
 */
const programShaOf = (program: string) => createHash('sha256').update(program).digest('hex')

export const storedRuntimeRefOf = (program: string) => ({
  kind: 'test-program',
  id: program,
  sha256: programShaOf(program),
})

export const storedTest: CalculatorRegistration = {
  kind: 'calculator',
  ref: 'stored-test@1',
  configSchema: Schema.Struct({
    program: Schema.String,
    brokenSha: Schema.optional(Schema.Boolean),
  }),
  bind: Effect.succeed({
    ref: 'stored-test@1',
    compile: (config, context) => {
      const spec = config as { program: string; brokenSha?: boolean }
      return Effect.succeed({
        inputSchema: normalizeInputSchema({
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        }),
        outputSchema: normalizeAtomicSchema(SCORE_AMOUNT_SCHEMA),
        contractHash: programShaOf(`contract:${spec.program}`),
        // the continuation lands in the frozen execution config, so a suite
        // can prove from the PERSISTED plan what the compile was handed: an
        // existing binding's identity, or nothing
        config: { program: spec.program, continuation: context.previousRuntimeRef?.id ?? null },
        runtimeRef:
          spec.brokenSha === true
            ? { kind: 'test-program', id: spec.program, sha256: 'not-a-hash' }
            : storedRuntimeRefOf(spec.program),
      })
    },
    verify: (frozen) => Effect.suspend(() => refuseUnlessExact(frozen)),
    prepare: (frozen) =>
      Effect.suspend(() =>
        Effect.as(refuseUnlessExact(frozen), {
          evaluate: () => Effect.succeed('5.00'),
        }),
      ),
  }),
}

/** the exact-match discipline formula@1 will hold the plan to: the frozen
 *  reference must be THIS program's, byte for byte, and a stored-program
 *  plan must say which profiles it was proven under */
const refuseUnlessExact = (frozen: FrozenCalculatorContract) => {
  const program = (frozen.config as { program?: unknown }).program
  if (typeof program !== 'string') {
    return Effect.fail(new CalculatorRuntimeError('the frozen config names no program'))
  }
  const ref = frozen.runtimeRef
  if (
    ref === undefined ||
    ref.kind !== 'test-program' ||
    ref.id !== program ||
    ref.sha256 !== programShaOf(program)
  ) {
    return Effect.fail(new CalculatorRuntimeError('the frozen runtime fact is not this program'))
  }
  if (frozen.valueSchemaProfileVersion === undefined || frozen.regexProfileVersion === undefined) {
    return Effect.fail(new CalculatorRuntimeError('a stored program demands its proving profiles'))
  }
  return Effect.void
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

/** every calculator registration a suite installs, builtin plus the tests' */
export const scoringRegistrations: readonly CalculatorRegistration[] = [
  ...builtinCalculators,
  gradedTest,
  twoFactTest,
  narrowFactTest,
  storedTest,
]

const contributed = <T>(values: readonly T[]): readonly Contributed<T>[] =>
  values.map((value) => ({ pluginId: '@qualy/plugin-assessment-tests', value }))

const definitions: readonly ScoringDefinition[] = [
  ...scoringRegistrations.map(({ kind, ref, configSchema }): ScoringDefinition => ({
    kind,
    ref,
    configSchema,
  })),
  ...builtinAggregators,
]

// Both catalogs come off the PRODUCTION providers, so what a suite installs
// is shaped by the same compile - and refused by the same rules - as what
// the host assembles. The runtime layer carries the provider's own boot-hook
// registration; these suites register it and never run a barrier.
// the provider hands back an erased AnyLayer; the narrowing here is the
// suites' one cast, same as the composition root's
const definitionLayer = (Scoring.definitionProvider as unknown as ProvideExtension).compile(
  contributed(definitions),
) as Layer.Layer<ScoringDefinitionCatalog>

export const scoringRuntimeLayer = (scoringRuntimeProvider as unknown as ProvideExtension).compile(
  contributed(scoringRegistrations),
)

/**
 * The compile face of a set of registrations, bound at the test boundary.
 *
 * Suites that call `compileScoringPlan` directly (no assembly, no layers)
 * still have to speak the runtime catalog's language; running `bind` here -
 * a test boundary, where Effect.run* is allowed - gives them the same
 * closed calculators the provider would have bound.
 */
export const testRuntime = (registrations: readonly CalculatorRegistration[]) => {
  const bound = new Map(registrations.map((one) => [one.ref, Effect.runSync(one.bind)]))
  const demand = (ref: string) => {
    const calculator = bound.get(ref)
    if (calculator === undefined) {
      throw new Error(`scoring calculator "${ref}" is not installed in this suite`)
    }
    return calculator
  }
  return {
    compile: (ref: string, config: unknown, context: CalculatorCompileContext) =>
      demand(ref).compile(config, context),
    verify: (ref: string, frozen: FrozenCalculatorContract, context: CalculatorHostContext) =>
      demand(ref).verify(frozen, context),
    prepare: (ref: string, frozen: FrozenCalculatorContract, context: CalculatorHostContext) =>
      demand(ref).prepare(frozen, context),
  }
}

/** the prepare-phase view of the same registrations, plus the aggregators */
export const testDefinitions = (
  registrations: readonly CalculatorRegistration[],
  aggregators: readonly AggregatorDriver[],
) => ({
  calculators: new Map(
    registrations.map((one) => [
      one.ref,
      { kind: 'calculator' as const, ref: one.ref, configSchema: one.configSchema },
    ]),
  ),
  aggregators: new Map(aggregators.map((one) => [one.ref, one])),
})

/** a compile-time host context for suites that never touch rows */
export const testHost = { tenantId: 'tenant-under-test', batchId: 'batch-under-test' }

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
  definitionLayer,
)
