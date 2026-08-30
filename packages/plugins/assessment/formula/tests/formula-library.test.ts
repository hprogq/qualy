import { inspect } from 'node:util'
import { Effect, Exit, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import type { Rbac } from '@qualy/rbac-contract/effect'
import { FormulaAuthoring } from '../src/server/authoring.ts'
import { FormulaLibrary, layer as formulaLayer } from '../src/server/index.ts'
import { one, seedFormulaFixture, servicesFor } from './support/stack.ts'

// The library end to end on a real database: authoring, optimistic
// concurrency, the whole publish pipeline (typecheck, bundle, sandbox
// contract, examples) and the frozen version row it produces. What the
// pipeline's stages each refuse is pinned by the bundler and artifact
// suites; here it is the service's own composition and records.

const stack = (url: string) =>
  formulaLayer.pipe(
    Layer.provide(sandboxLocalLayer({ size: 1, variant: 'release' })),
    Layer.provide(formulaAuthoringLocalLayer),
    Layer.provideMerge(servicesFor(url)),
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, FormulaLibrary | Rbac | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const seed = seedFormulaFixture

const IDENTITY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2 }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

describe.runIf(postgresAvailable)('the formula library', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-formula')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('authors, publishes and freezes an identity formula end to end', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fx-publish')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { ownerNodeId: f.collegeA, name: '认定分值', description: '直接采用认定分值' },
            as,
          )
          const drafted = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: created.draftRevision,
              draftSourceTs: IDENTITY,
              draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '3' }],
            },
            as,
          )
          const version = yield* library.publish(f.t, created.id, drafted.draftRevision, as)
          const detail = yield* library.getFunction(f.t, created.id, as)
          const listed = yield* library.listFunctions(f.t, {}, as)
          return { created, version, detail, listed }
        }),
      ),
    )
    expect(outcome.version.versionNo).toBe(1)
    for (const hash of [
      outcome.version.sourceSha256,
      outcome.version.runtimeSha256,
      outcome.version.contractSha256,
      outcome.version.formulaRuntimeSha256,
    ])
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(outcome.version.formulaAbiVersion).toBe(1)
    expect(outcome.version.typescriptVersion).toContain('7.')
    expect(outcome.version.esbuildVersion).toMatch(/^\d+\./)
    expect(outcome.version.quickjsEngineVersion).toContain('quickjs')
    expect(outcome.version.testReport).toEqual([
      { name: 'three', passed: true, expected: '3', actual: '3' },
    ])
    expect(outcome.detail.versions.map((row) => row.versionNo)).toEqual([1])
    expect(outcome.listed.items.map((row) => row.latestVersionNo)).toEqual([1])
  }, 120_000)

  it('refuses to publish what does not hold: types, examples, stale drafts', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fx-refusals')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { ownerNodeId: f.collegeA, name: 'Broken' },
            as,
          )

          // the default draft carries no examples: publishing has nothing proven
          const untested = yield* Effect.flip(
            library.publish(f.t, created.id, created.draftRevision, as),
          )

          const badTyped = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: created.draftRevision,
              draftSourceTs: IDENTITY.replace('(input) => input.value', '(input) => true'),
              draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '3' }],
            },
            as,
          )
          const misTyped = yield* Effect.flip(
            library.publish(f.t, created.id, badTyped.draftRevision, as),
          )

          const wrongAnswer = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: badTyped.draftRevision,
              draftSourceTs: IDENTITY,
              draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '4' }],
            },
            as,
          )
          const failing = yield* Effect.flip(
            library.publish(f.t, created.id, wrongAnswer.draftRevision, as),
          )

          const smuggling = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: wrongAnswer.draftRevision,
              draftSourceTs: `import fs from 'node:fs'\n${IDENTITY}`,
              draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '3' }],
            },
            as,
          )
          const smuggled = yield* Effect.flip(
            library.publish(f.t, created.id, smuggling.draftRevision, as),
          )

          const stale = yield* Effect.flip(
            library.updateDraft(
              f.t,
              created.id,
              { expectedDraftRevision: 1, draftSourceTs: IDENTITY },
              as,
            ),
          )
          return { untested, misTyped, failing, smuggled, stale }
        }),
      ),
    )
    expect(outcome.untested._tag).toBe('ASSESSMENT_FORMULA_TEST_FAILED')
    expect(outcome.misTyped._tag).toBe('ASSESSMENT_FORMULA_TYPECHECK_FAILED')
    expect(
      (outcome.misTyped as { diagnostics: readonly { code: string }[] }).diagnostics.length,
    ).toBeGreaterThan(0)
    expect(outcome.smuggled._tag).toBe('ASSESSMENT_FORMULA_SOURCE_REFUSED')
    expect(outcome.smuggled).toMatchObject({ reason: 'import', specifier: 'node:fs' })
    expect(outcome.failing._tag).toBe('ASSESSMENT_FORMULA_TEST_FAILED')
    expect(
      (outcome.failing as { report: readonly { passed: boolean; actual?: string }[] }).report,
    ).toEqual([{ name: 'three', passed: false, expected: '4', actual: '3' }])
    expect(outcome.stale._tag).toBe('ASSESSMENT_FORMULA_DRAFT_CONFLICT')
  }, 120_000)

  it('answers a forged contract with a refusal, never a host-side defect', async () => {
    // the type system is not a trust boundary: an assertion can hand the
    // extractor input: undefined, and every validator on the host must
    // fail closed into a 422 instead of throwing
    const forged = `import { Schema, defineFormula } from '@qualy/formula'

const definition = defineFormula({
  input: Schema.input({}),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (_input, q) => q.decimal.fromInteger(0),
})

export default { ...definition, input: undefined } as unknown as typeof definition
`
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fx-forged')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { ownerNodeId: f.collegeA, name: 'Forged' },
            as,
          )
          const drafted = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: created.draftRevision,
              draftSourceTs: forged,
              draftTests: [{ name: 'zero', input: {}, expected: '0' }],
            },
            as,
          )
          return yield* Effect.flip(library.publish(f.t, created.id, drafted.draftRevision, as))
        }),
      ),
    )
    expect(outcome._tag).toBe('ASSESSMENT_FORMULA_CONTRACT_INVALID')
    expect((outcome as { issues: readonly { path: string; reason: string }[] }).issues).toEqual([
      { path: 'input', reason: 'not-an-object' },
    ])
  }, 120_000)

  it('judges what came back against the output contract, and types each failure', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fx-output-contract')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { ownerNodeId: f.collegeA, name: '越界公式', description: '' },
            as,
          )
          // the contract admits at most 5.00; the body answers 7 for a large
          // enough input - schema-legal everywhere, broken only at runtime
          const source = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    ordinal: Schema.integer({ minimum: 1, maximum: 10 }),
  }),
  output: Schema.decimal({ minimum: '0.00', maximum: '5.00', maxScale: 2 }),
  run: (input, q) => {
    if (input.ordinal > 9) q.fail('x'.repeat(100000))
    if (input.ordinal > 8) q.decimal.quantize(q.decimal.fromInteger(1), -1)
    return q.decimal.fromInteger(input.ordinal)
  },
})
`
          const evaluated = yield* library.evaluateDraft(
            f.t,
            created.id,
            source,
            [
              { input: { ordinal: 3 } },
              { input: { ordinal: 7 } },
              { input: { ordinal: 10 } },
              { input: { ordinal: 9 } },
            ],
            as,
          )
          return evaluated.results
        }),
      ),
    )
    const [fine, violating, refused, misused] = outcome
    // a legal answer flows through untouched
    expect(fine!.actual).toBe('3')
    // an answer past the contract is an output problem, never a normal actual
    expect(violating!.actual).toBeUndefined()
    expect(violating!.problems).toEqual([
      { at: 'output', reason: 'x-qualy-maximum', constraint: '5' },
    ])
    // a business refusal arrives as one, its words capped at the source
    expect(refused!.refusal).toHaveLength(2048)
    expect(refused!.defect).toBeUndefined()
    // misusing the SDK is the formula crashing, never a polite refusal
    expect(misused!.defect).toBeDefined()
    expect(misused!.refusal).toBeUndefined()
  }, 120_000)

  it('refuses an artifact whose formula abi this host does not speak', async () => {
    const outcome = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const f = yield* seed('fx-abi-drift')
        const library = yield* FormulaLibrary
        const as = f.principal(f.admin)
        const created = yield* library.createFunction(
          f.t,
          { ownerNodeId: f.collegeA, name: '旧编译器', description: '' },
          as,
        )
        return yield* Effect.exit(library.previewDraft(f.t, created.id, IDENTITY, as))
      }).pipe(
        Effect.provide(
          formulaLayer.pipe(
            Layer.provide(sandboxLocalLayer({ size: 1, variant: 'release' })),
            // an authoring sidecar from before this host's ABI: the artifact
            // it hands back is real, its identity is not one we may record
            Layer.provide(
              Layer.effect(
                FormulaAuthoring,
                Effect.gen(function* () {
                  const real = yield* Effect.provide(
                    FormulaAuthoring as Effect.Effect<
                      typeof FormulaAuthoring.Service,
                      never,
                      FormulaAuthoring
                    >,
                    formulaAuthoringLocalLayer,
                  )
                  return {
                    compile: (source: string) =>
                      Effect.map(real.compile(source), (compiled) => ({
                        ...compiled,
                        formulaAbiVersion: compiled.formulaAbiVersion + 1,
                      })),
                  }
                }),
              ),
            ),
            Layer.provideMerge(servicesFor(db.url)),
          ),
        ),
      ),
    )
    const preview = ok(outcome)
    expect(Exit.isFailure(preview)).toBe(true)
    if (Exit.isFailure(preview)) {
      const failure = preview.cause as { reasons?: readonly { error?: { _tag?: string } }[] }
      expect(failure.reasons?.[0]?.error?._tag).toBe('ASSESSMENT_FORMULA_COMPILE_UNAVAILABLE')
    }
  }, 120_000)

  it('keeps unauthorized readers outside: empty lists, unknown functions', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fx-access')
          const library = yield* FormulaLibrary
          const admin = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { ownerNodeId: f.collegeA, name: 'Private' },
            admin,
          )
          const outsider = f.principal(f.bystander)
          const listed = yield* library.listFunctions(f.t, {}, outsider)
          const denied = yield* Effect.flip(library.getFunction(f.t, created.id, outsider))
          const archived = yield* library.setStatus(f.t, created.id, 'archived', admin)
          const editRefused = yield* Effect.flip(
            library.updateDraft(
              f.t,
              created.id,
              { expectedDraftRevision: archived.draftRevision, draftSourceTs: IDENTITY },
              admin,
            ),
          )
          return { listed, denied, editRefused }
        }),
      ),
    )
    expect(outcome.listed.items).toEqual([])
    expect(outcome.denied._tag).toBe('ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND')
    expect(outcome.editRefused._tag).toBe('ASSESSMENT_FORMULA_FUNCTION_ARCHIVED')
  }, 120_000)
})
