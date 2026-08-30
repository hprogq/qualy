import { Effect, Exit, Layer, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Contributed, ProvideExtension } from '@qualy/plugin-kit'
import {
  ItemTypeCatalog,
  ItemTypes,
  Scoring,
  ScoringDefinitionCatalog,
  type CalculatorRegistration,
  type ItemTypeDriver,
  type ScoringDefinition,
} from '../src/plugin.ts'
import { bindScoringRuntimes } from '../src/scoring/runtime-provider.ts'
import { builtinAggregators, builtinCalculators, fixed1, sum1 } from '../src/scoring/builtins.ts'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import type { CalculatorContract } from '../src/plugin.ts'

/** the smallest legal contract: needs nothing, answers a decimal */
const emptyContract: CalculatorContract = {
  inputSchema: normalizeInputSchema({
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  }),
  outputSchema: normalizeAtomicSchema({
    type: 'string',
    format: 'qualy-decimal',
    'x-qualy-maxScale': 4,
  }),
  contractHash: 'test-contract',
}

// The two channels other plugins extend assessment through, compiled the way
// the assembler compiles them.
//
// What matters is the refusals: a duplicate driver id must fail the assembly
// rather than let load order decide which plugin a stored item_type meant,
// and a config amount must be a decimal string from the very first saved
// configuration - a JSON float that slips in here becomes a rounding error
// somebody explains to a student years later.

const driver = (id: string, over: Partial<ItemTypeDriver> = {}): ItemTypeDriver => ({
  id,
  configSchema: Schema.Struct({}),
  decodePayload: (_config, payload) => Effect.succeed(payload),
  attachmentRefs: () => [],
  interaction: 'entry',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
  ...over,
})

// The provider values are typed as the descriptor union; tests are a host of
// sorts, so they narrow the same way the assembler does before compiling.
const compileOf = (provider: unknown) => (provider as ProvideExtension).compile

/** compiles contributions the way the assembler would, and reads the result */
const itemCatalogOf = (contributions: readonly Contributed<ItemTypeDriver>[]) =>
  Effect.runSync(
    ItemTypeCatalog.pipe(
      Effect.provide(compileOf(ItemTypes.provider)(contributions) as Layer.Layer<ItemTypeCatalog>),
    ),
  )

const definitionLayerOf = (contributions: readonly Contributed<ScoringDefinition>[]) =>
  compileOf(Scoring.definitionProvider)(contributions) as Layer.Layer<ScoringDefinitionCatalog>

const scoringCatalogOf = (contributions: readonly Contributed<ScoringDefinition>[]) =>
  Effect.runSync(ScoringDefinitionCatalog.pipe(Effect.provide(definitionLayerOf(contributions))))

/** the definition half Scoring.calculator would derive from a registration */
const definitionOf = (registration: CalculatorRegistration): ScoringDefinition => ({
  kind: 'calculator',
  ref: registration.ref,
  configSchema: registration.configSchema,
})

describe('the item-type registry', () => {
  it('compiles declared drivers into a catalog', () => {
    const evidence = driver('evidence')
    const catalog = itemCatalogOf([
      { pluginId: '@qualy/plugin-assessment-evidence', value: evidence },
    ])
    expect(catalog.get('evidence')).toBe(evidence)
    expect(catalog.has('appraisal.teacher')).toBe(false)
  })

  it('refuses a driver id the item_type column would refuse', () => {
    // the same rule as the database check, applied where the plugin author
    // is: a driver that assembles and dies on the first item created would
    // point everyone at the wrong file
    for (const id of ['Evidence', 'foo/bar', 'foo..bar', 'foo.', '-foo', '']) {
      expect(() => ItemTypes.driver(driver(id)), id).toThrow(/lowercase dot-or-dash/)
    }
    for (const id of ['evidence', 'appraisal.teacher', 'foo-bar', 'grades.derived']) {
      expect(() => ItemTypes.driver(driver(id)), id).not.toThrow()
    }
  })

  it('refuses two plugins claiming one item type', () => {
    expect(() =>
      compileOf(ItemTypes.provider)([
        { pluginId: '@qualy/plugin-a', value: driver('evidence') },
        { pluginId: '@qualy/plugin-b', value: driver('evidence') },
      ]),
    ).toThrow(/two plugins provide the item type "evidence"/)
  })
})

describe('the scoring registry', () => {
  it('files calculators and aggregators apart, under their refs', () => {
    const catalog = scoringCatalogOf(
      [...builtinCalculators.map(definitionOf), ...builtinAggregators].map((value) => ({
        pluginId: '@qualy/plugin-assessment',
        value,
      })),
    )
    expect(catalog.calculators.get('fixed@1')?.configSchema).toBe(fixed1.configSchema)
    expect(catalog.aggregators.get('sum@1')).toBe(sum1)
    // a calculator ref does not answer for an aggregator, or the reverse
    expect(catalog.calculators.has('sum@1')).toBe(false)
    expect(catalog.aggregators.has('fixed@1')).toBe(false)
  })

  it('refuses a second owner for one ref, but allows the same ref across kinds', () => {
    expect(() =>
      compileOf(Scoring.definitionProvider)([
        { pluginId: '@qualy/plugin-assessment', value: definitionOf(fixed1) },
        { pluginId: '@qualy/plugin-rival', value: definitionOf(fixed1) },
      ]),
    ).toThrow(/two plugins provide the calculator "fixed@1"/)

    // one word, two roles: a calculator and an aggregator may share a ref,
    // because an item's config names them in different positions
    const catalog = scoringCatalogOf([
      {
        pluginId: '@qualy/a',
        value: { kind: 'calculator', ref: 'x@1', configSchema: Schema.Struct({}) },
      },
      {
        pluginId: '@qualy/b',
        value: {
          kind: 'aggregator',
          ref: 'x@1',
          configSchema: Schema.Struct({}),
          aggregate: () => ({ total: 0n, entries: [] }),
        },
      },
    ])
    expect(catalog.calculators.has('x@1')).toBe(true)
    expect(catalog.aggregators.has('x@1')).toBe(true)
  })

  it('refuses a ref that is not name@version', () => {
    for (const ref of ['fixed', 'fixed@0', 'fixed@1.2', 'Fixed@1', 'fixed@v1', '@1']) {
      expect(() =>
        Scoring.calculator({
          kind: 'calculator',
          ref,
          configSchema: Schema.Struct({}),
          bind: Effect.succeed({
            ref,
            compile: (config) => Effect.succeed({ ...emptyContract, config }),
            verify: () => Effect.void,
            prepare: () => Effect.succeed({ evaluate: () => Effect.succeed('0') }),
          }),
        }),
      ).toThrow(/name@version/)
      expect(() =>
        Scoring.aggregator({
          kind: 'aggregator',
          ref,
          configSchema: Schema.Struct({}),
          aggregate: () => ({ total: 0n, entries: [] }),
        }),
      ).toThrow(/name@version/)
    }
  })
})

describe('the runtime channel and the definitions, one story', () => {
  // The completeness gate is a calculator-only equality: a declared
  // calculator with no runtime cannot execute anything, and a runtime nobody
  // declared cannot be configured - both are a broken assembly, refused with
  // the refs named. Aggregators deliberately sit outside the equality: an
  // aggregator IS its definition, whole, with no runtime half.
  const registration = (ref: string): CalculatorRegistration => ({
    kind: 'calculator',
    ref,
    configSchema: Schema.Struct({}),
    bind: Effect.succeed({
      ref,
      compile: (config) => Effect.succeed({ ...emptyContract, config }),
      verify: () => Effect.void,
      prepare: () => Effect.succeed({ evaluate: () => Effect.succeed('0') }),
    }),
  })

  const boundOver = (
    definitions: readonly ScoringDefinition[],
    registrations: readonly CalculatorRegistration[],
  ) =>
    Effect.runSyncExit(
      bindScoringRuntimes(
        registrations.map((value) => ({ pluginId: '@qualy/plugin-under-test', value })),
      ).pipe(
        Effect.provide(
          definitionLayerOf(
            definitions.map((value) => ({ pluginId: '@qualy/plugin-under-test', value })),
          ),
        ),
        // the registrations' erased R, closed by the test the way the
        // composition root closes the provider's layer
      ) as unknown as Effect.Effect<unknown, unknown>,
    )

  it('refuses a declared calculator with no runtime registration', () => {
    const outcome = boundOver([definitionOf(registration('lonely@1'))], [])
    expect(Exit.isFailure(outcome)).toBe(true)
    expect(String(outcome)).toMatch(/"lonely@1" is declared but has no runtime registration/)
  })

  it('refuses a runtime registration nobody declared', () => {
    const outcome = boundOver([], [registration('stray@1')])
    expect(Exit.isFailure(outcome)).toBe(true)
    expect(String(outcome)).toMatch(/"stray@1" is registered but never declared/)
  })

  it('accepts an aggregator with no runtime half', () => {
    const outcome = boundOver(
      [definitionOf(registration('paired@1')), sum1],
      [registration('paired@1')],
    )
    expect(Exit.isSuccess(outcome)).toBe(true)
  })

  it('refuses two registrations for one ref, and a bind that renames itself', () => {
    const doubled = boundOver(
      [definitionOf(registration('twice@1'))],
      [registration('twice@1'), registration('twice@1')],
    )
    expect(String(doubled)).toMatch(/two plugins register the calculator runtime "twice@1"/)

    const renamed = boundOver(
      [definitionOf(registration('spoken@1'))],
      [
        {
          ...registration('spoken@1'),
          bind: Effect.runSync(Effect.succeed(registration('other@1').bind)),
        },
      ],
    )
    expect(String(renamed)).toMatch(/registered as "spoken@1" bound itself as "other@1"/)
  })
})

describe('the fixed@1 configuration shape', () => {
  const decode = (input: unknown) =>
    Effect.runSyncExit(
      Schema.decodeUnknownEffect(fixed1.configSchema as Schema.Codec<unknown>)(input),
    )

  it('accepts decimal strings, signed and up to four places', () => {
    for (const value of ['3.00', '-1.00', '0.5', '15', '-0.125', '0.0001']) {
      expect(Exit.isSuccess(decode({ value })), value).toBe(true)
    }
  })

  it('refuses floats, garbage and over-precise amounts', () => {
    // the whole point of string amounts: 3.00 the number is refused, so no
    // config ever depends on how a float happens to print
    for (const value of [3, 3.0, '3.', '.5', '3.00001', 'three', '', '1e3', null]) {
      expect(Exit.isSuccess(decode({ value })), String(value)).toBe(false)
    }
  })
})
