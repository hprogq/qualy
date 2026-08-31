import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { currentResolution } from '@qualy/assembly/host'
import { manifestPath } from '../lib/manifest.ts'

// Where the arithmetic may reach, and where it may not.
//
// Scoring has two halves on purpose. Evaluating what a claim is worth is
// allowed to reach for services - a calculator backed by a stored function
// has to read one, and one day it will run guest code in a sandbox. The
// ledger below it is a pure function of amounts: no effects, no database, no
// clock, no guest execution. That line is what makes "the same frozen facts
// give the byte-identical breakdown" a property rather than a hope, and it
// is not a line a type can hold - so it is held here.

const root = path.resolve(import.meta.dirname, '../..')

// the production assembly, loaded the way the runtime loads it
const resolution = await currentResolution(manifestPath())
// contributions WITH their owner: which plugin ships a driver is half of
// what these gates are about, and a value alone cannot say
const contributions = (point: string): readonly { pluginId: string; value: unknown }[] =>
  [...resolution.descriptors.entries()].flatMap(([pluginId, descriptor]) =>
    descriptor.features.flatMap((feature) =>
      feature._tag === 'Contribute' && feature.point.id === point
        ? [{ pluginId, value: feature.value }]
        : [],
    ),
  )

const valuesOf = (point: string): unknown[] =>
  contributions(point).map((contribution) => contribution.value)

const codeOnly = (source: string) =>
  source.split('\n').map((line) =>
    line
      .replace(/\/\*.*?\*\//g, '')
      .replace(/\/\/.*$/, '')
      .replace(/^\s*\*.*$/, ''),
  )

const breaches = (
  files: readonly string[],
  rules: readonly { pattern: RegExp; why: string }[],
): string[] =>
  files.flatMap((file) =>
    codeOnly(fs.readFileSync(path.join(root, file), 'utf8')).flatMap((line, index) =>
      rules
        .filter((rule) => rule.pattern.test(line))
        .map((rule) => `${file}:${index + 1} ${rule.why}`),
    ),
  )

/** the pure half: an account, from amounts already decided */
const LEDGER = ['packages/plugins/assessment/core/src/scoring/calc.ts']

const FORBIDDEN = [
  { pattern: /from ['"]effect['"]/, why: 'imports Effect into the pure ledger' },
  { pattern: /from ['"].*plugin-sandbox/, why: 'reaches guest execution from the pure ledger' },
  { pattern: /from ['"].*assessment-formula/, why: 'reaches the formula plugin from the ledger' },
  { pattern: /from ['"].*\/db\.ts['"]/, why: 'queries the database from the pure ledger' },
  { pattern: /from ['"]kysely['"]/, why: 'builds sql in the pure ledger' },
  { pattern: /\bpayload\b/, why: 'reads a filing as scoring input' },
]

const manifestOf = (dir: string) =>
  JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8')) as {
    name: string
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }

describe('the line between evaluating and accounting', () => {
  it('keeps the ledger pure', () => {
    expect(breaches(LEDGER, FORBIDDEN)).toEqual([])
  })

  it('keeps guest execution and the formula library out of assessment core', () => {
    // Core knows calculators by reference and contract; it must not learn
    // what a formula or a sandbox is. When formula@1 arrives it arrives as
    // a plugin contributing a driver, never as a dependency of this one.
    const deps = Object.keys(manifestOf('packages/plugins/assessment/core').dependencies ?? {})
    for (const banned of [
      '@qualy/plugin-sandbox',
      '@qualy/plugin-assessment-formula',
      '@qualy/sandbox-engine',
      '@qualy/formula-compiler',
      // the author SDK too, not only the plugin around it: what a score may
      // be is the platform's rule and lives in the value layer, so core
      // depending on the formula library to learn it points the arrow the
      // wrong way round - the formula plugin depends on assessment, never
      // the other way
      '@qualy/formula',
      'quickjs-emscripten',
    ]) {
      expect(deps, banned).not.toContain(banned)
    }
  })

  it('gives the platform amount one meaning, spelled in two places', async () => {
    // The author SDK builds it with its own builder because a formula's
    // artifact bundles that module and must not carry a constant only hosts
    // read; the value layer declares it because assessment must not depend
    // on a formula library to learn what a score is. Two spellings, and
    // this is what stops them becoming two rules.
    // by path: this gate belongs to the repository, which declares neither
    // package as a dependency of its own
    const [sdk, platform] = await Promise.all([
      import('../../packages/core/formula/src/schema.ts'),
      import('../../packages/core/value-schema/src/score.ts'),
    ])
    expect(sdk.SCORE_AMOUNT_SCHEMA).toEqual(platform.SCORE_AMOUNT_SCHEMA)
  })

  it('keeps the scoring domain blind to evidence field kinds', () => {
    // Scoring consumes AtomicSchema, BindableField and AssignmentPlan; what
    // an evidence text or choice field IS belongs to the driver. A type
    // dispatch here would be the compiler learning a vocabulary it must
    // never own. (The display chain's attachment knowledge is older debt
    // and deliberately not this gate's business.)
    const domain = [
      'packages/plugins/assessment/core/src/scoring/plan.ts',
      'packages/plugins/assessment/core/src/scoring/recognition.ts',
      'packages/plugins/assessment/core/src/scoring/evaluate.ts',
      'packages/plugins/assessment/core/src/scoring/calc.ts',
      'packages/plugins/assessment/core/src/scoring/builtins.ts',
      'packages/plugins/assessment/core/src/scoring/backfill.ts',
    ]
    const dispatch =
      /(?:type\s*===?\s*|case\s+)['"](text|integer|decimal|choice|date|attachment)['"]/
    const offences = domain.flatMap((path) => {
      const source = fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
      return source
        .split('\n')
        .flatMap((line, at) =>
          dispatch.test(line) && !line.trimStart().startsWith('//') ? [`${path}:${at + 1}`] : [],
        )
    })
    expect(offences).toEqual([])
  })

  it('ships exactly one formula calculator, declared by the formula plugin', async () => {
    // From the assembled declarations, not a directory listing: what is
    // registered is what runs, wherever its file happens to live. The
    // deliberate decision this gate once held shut - shipping a formula
    // scoring driver at all - has been taken: formula@1 is registered by
    // the formula plugin, exactly once, in BOTH scoring channels (the
    // declaration and the runtime binding travel as a pair or the boot
    // refuses). Anything beyond that one ref, or the same ref from any
    // other plugin, is still a decision nobody has made.
    const definitions = contributions('@qualy/plugin-assessment/scoring-definitions')
    const runtimes = contributions('@qualy/plugin-assessment/scoring-runtimes')
    expect(definitions.length).toBeGreaterThan(0)
    expect(runtimes.length).toBeGreaterThan(0)
    for (const channel of [definitions, runtimes]) {
      // owner AND ref: a formula driver that moved into assessment core, or
      // into some third plugin, would still be one ref in both channels -
      // and would still be a decision nobody made
      const formula = channel
        .filter((contribution) =>
          (contribution.value as { ref?: string }).ref?.startsWith('formula@'),
        )
        .map((contribution) => ({
          pluginId: contribution.pluginId,
          ref: (contribution.value as { ref: string }).ref,
        }))
      expect(formula).toEqual([{ pluginId: '@qualy/plugin-assessment-formula', ref: 'formula@1' }])
    }
  })

  it('keeps the shared value form exactly as light as it claims', () => {
    const manifest = manifestOf('packages/web/value-form')
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qualy/ui',
      '@qualy/value-schema',
      '@stylexjs/stylex',
    ])
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual(['react'])
  })

  it('never offers a file for binding', () => {
    // the plugin's own suite proves the same thing against its source; this
    // copy runs against the assembled declarations, so a second item-type
    // driver cannot arrive offering attachments to scoring unnoticed
    const drivers = valuesOf('@qualy/plugin-assessment/item-types') as readonly {
      id: string
      bindableFields?: (config: unknown) => readonly { fieldId: string; schema: unknown }[]
    }[]
    expect(drivers.length).toBeGreaterThan(0)
    for (const driver of drivers) {
      if (driver.bindableFields === undefined) continue
      const offered = driver.bindableFields({
        fields: [
          { key: 'note', type: 'text', label: 'N' },
          { key: 'proof', type: 'attachment', label: 'P', maxCount: 1 },
        ],
      })
      for (const field of offered) expect(field.schema).not.toBeNull()
      expect(offered.map((field) => field.fieldId)).toEqual(['note'])
    }
  })
})
