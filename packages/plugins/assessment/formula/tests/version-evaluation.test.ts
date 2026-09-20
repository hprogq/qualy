import { inspect } from 'node:util'
import { Effect, Exit, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import type { Rbac } from '@qualy/rbac-contract/effect'
import { FormulaLibrary, layer as formulaLayer } from '../src/server/index.ts'
import { seedFormulaFixture, servicesFor } from './support/stack.ts'
import { publishedVersion } from './support/versions.ts'

// Trying a published version runs what publication froze: the stored
// artifact and contract, proven again by the runtime store, and never the
// source compiled a second time. The draft moving on, the function being
// archived, or today's compiler reading the source differently must not
// change what the version answers - and a stored record that no longer holds
// is refused rather than run.

const stack = (url: string) =>
  formulaLayer.pipe(
    Layer.provide(sandboxLocalLayer({ size: 1, variant: 'release' })),
    Layer.provide(formulaAuthoringLocalLayer),
    Layer.provideMerge(servicesFor(url)),
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, FormulaLibrary | Rbac | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url) as never) as Effect.Effect<A, E>)

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const IDENTITY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2, title: '分值' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

const DOUBLED = IDENTITY.replace(
  'run: (input) => input.value,',
  'run: (input, q) => q.decimal.add(input.value, input.value),',
)

const CASES = [
  { input: { value: '3.00' } },
  { input: { value: '2.50' }, expected: '2.5' },
  { input: { value: '2.00' }, expected: '5' },
  // past the frozen contract's maximum: refused before the formula runs
  { input: { value: '11.00' }, expected: '11' },
]

describe.runIf(postgresAvailable)('trying a published version', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-formula-version-evaluation')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('answers with what publication froze, whatever the draft says now', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('fve-frozen')
          const library = yield* FormulaLibrary
          const as = f.principal(f.authorA)
          const created = yield* library.createFunction(f.t, { name: '认定分值' }, as)
          yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: 1,
              draftSourceTs: IDENTITY,
              draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '3' }],
            },
            as,
          )
          const published = yield* library.publish(
            f.t,
            created.id,
            { expectedDraftRevision: 2, releaseName: '春季规则' },
            as,
          )
          // the draft moves on to another rule
          yield* library.updateDraft(
            f.t,
            created.id,
            { expectedDraftRevision: 2, draftSourceTs: DOUBLED },
            as,
          )
          const tried = yield* library.evaluateVersion(f.t, created.id, 1, CASES, as)
          // the same cases against the source the version was published from:
          // one evaluator, so the two must agree row for row
          const asDraft = yield* library.evaluateDraft(f.t, created.id, IDENTITY, CASES, as)
          // trying writes nothing, so an archived function's versions still run
          yield* library.setStatus(f.t, created.id, 'archived', as)
          const archived = yield* library.evaluateVersion(f.t, created.id, 1, CASES, as)

          const missing = yield* Effect.flip(library.evaluateVersion(f.t, created.id, 9, CASES, as))
          // somebody else's formula reads as absent, the version with it
          const stranger = yield* Effect.flip(
            library.evaluateVersion(f.t, created.id, 1, CASES, f.principal(f.authorB)),
          )
          // and without the capability there is no authoring plane at all
          yield* f.revokeAuthoring(f.authorA)
          const revoked = yield* Effect.flip(library.evaluateVersion(f.t, created.id, 1, CASES, as))
          return { published, tried, asDraft, archived, missing, stranger, revoked }
        }),
      ),
    )
    expect(outcome.tried.contractSha256).toBe(outcome.published.contractSha256)
    expect(outcome.tried.inputSchema).toEqual(outcome.published.inputSchema)
    expect(outcome.tried.outputSchema).toEqual(outcome.published.outputSchema)
    expect(outcome.tried.results).toEqual([
      { actual: '3' },
      { actual: '2.5', passed: true, expected: '2.5' },
      { actual: '2', passed: false, expected: '5' },
      {
        passed: false,
        expected: '11',
        problems: [expect.objectContaining({ at: 'input', parameter: 'value' })],
      },
    ])
    expect(outcome.tried.results).toEqual(outcome.asDraft.results)
    expect(outcome.archived.results).toEqual(outcome.tried.results)
    expect(outcome.missing._tag).toBe('ASSESSMENT_FORMULA_VERSION_NOT_FOUND')
    expect(outcome.stranger._tag).toBe('ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND')
    expect(outcome.revoked._tag).toBe('ACCESS_DENIED')
  }, 180_000)

  it('refuses a version whose stored record no longer holds', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('fve-unrunnable')
          const library = yield* FormulaLibrary
          const as = f.principal(f.authorA)
          const { functionId, versionId } = yield* publishedVersion(f.t, f.authorA, '被改动的公式')
          // the record resolves as stored: no case, so nothing reaches the sandbox
          const intact = yield* library.evaluateVersion(f.t, functionId, 1, [], as)

          yield* runSql(sql`
            update assessment_formula_versions
            set runtime_js = runtime_js || '/*tampered*/' where id = ${versionId}`)
          const tamperedRuntime = yield* Effect.flip(
            library.evaluateVersion(f.t, functionId, 1, [], as),
          )
          yield* runSql(sql`
            update assessment_formula_versions
            set runtime_js = left(runtime_js, length(runtime_js) - length('/*tampered*/'))
            where id = ${versionId}`)

          const contract = yield* runSql(sql`
            select contract_sha256 from assessment_formula_versions where id = ${versionId}`)
          yield* runSql(sql`
            update assessment_formula_versions
            set contract_sha256 = ${'0'.repeat(64)} where id = ${versionId}`)
          const tamperedContract = yield* Effect.flip(
            library.evaluateVersion(f.t, functionId, 1, [], as),
          )
          yield* runSql(sql`
            update assessment_formula_versions
            set contract_sha256 = ${(contract as { rows: { contract_sha256: string }[] }).rows[0]!.contract_sha256}
            where id = ${versionId}`)

          // a record this build holds no evidence it can run faithfully
          yield* runSql(sql`
            update assessment_formula_versions set formula_abi_version = 999 where id = ${versionId}`)
          const unsupported = yield* Effect.flip(
            library.evaluateVersion(f.t, functionId, 1, [], as),
          )
          return { intact, tamperedRuntime, tamperedContract, unsupported }
        }),
      ),
    )
    expect(outcome.intact.results).toEqual([])
    expect(outcome.intact.contractSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(outcome.tamperedRuntime._tag).toBe('ASSESSMENT_FORMULA_VERSION_UNRUNNABLE')
    expect(outcome.tamperedContract._tag).toBe('ASSESSMENT_FORMULA_VERSION_UNRUNNABLE')
    expect(outcome.unsupported._tag).toBe('ASSESSMENT_FORMULA_VERSION_UNRUNNABLE')
  }, 120_000)
})
