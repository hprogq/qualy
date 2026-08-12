import { Effect, Exit, Layer, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Contributed, ProvideExtension } from '@qualy/plugin-kit'
import {
  ItemTypeCatalog,
  ItemTypes,
  Scoring,
  ScoringCatalog,
  type ItemTypeDriver,
  type ScoringDriver,
} from '../src/plugin.ts'
import { builtinScoringDrivers, fixed1, sum1 } from '../src/scoring/builtins.ts'

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
    Effect.gen(function* () {
      return yield* ItemTypeCatalog
    }).pipe(
      Effect.provide(compileOf(ItemTypes.provider)(contributions) as Layer.Layer<ItemTypeCatalog>),
    ),
  )

const scoringCatalogOf = (contributions: readonly Contributed<ScoringDriver>[]) =>
  Effect.runSync(
    Effect.gen(function* () {
      return yield* ScoringCatalog
    }).pipe(
      Effect.provide(compileOf(Scoring.provider)(contributions) as Layer.Layer<ScoringCatalog>),
    ),
  )

describe('the item-type registry', () => {
  it('compiles declared drivers into a catalog', () => {
    const evidence = driver('evidence')
    const catalog = itemCatalogOf([
      { pluginId: '@qualy/plugin-assessment-evidence', value: evidence },
    ])
    expect(catalog.get('evidence')).toBe(evidence)
    expect(catalog.has('appraisal.teacher')).toBe(false)
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
      builtinScoringDrivers.map((value) => ({ pluginId: '@qualy/plugin-assessment', value })),
    )
    expect(catalog.calculators.get('fixed@1')).toBe(fixed1)
    expect(catalog.aggregators.get('sum@1')).toBe(sum1)
    // a calculator ref does not answer for an aggregator, or the reverse
    expect(catalog.calculators.has('sum@1')).toBe(false)
    expect(catalog.aggregators.has('fixed@1')).toBe(false)
  })

  it('refuses a second owner for one ref, but allows the same ref across kinds', () => {
    const rival: ScoringDriver = {
      kind: 'calculator',
      ref: 'fixed@1',
      configSchema: Schema.Struct({}),
    }
    expect(() =>
      compileOf(Scoring.provider)([
        { pluginId: '@qualy/plugin-assessment', value: fixed1 },
        { pluginId: '@qualy/plugin-rival', value: rival },
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
        value: { kind: 'aggregator', ref: 'x@1', configSchema: Schema.Struct({}) },
      },
    ])
    expect(catalog.calculators.has('x@1')).toBe(true)
    expect(catalog.aggregators.has('x@1')).toBe(true)
  })

  it('refuses a ref that is not name@version', () => {
    for (const ref of ['fixed', 'fixed@0', 'fixed@1.2', 'Fixed@1', 'fixed@v1', '@1']) {
      expect(() =>
        Scoring.driver({ kind: 'calculator', ref, configSchema: Schema.Struct({}) }),
      ).toThrow(/name@version/)
    }
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
