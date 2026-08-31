import { inspect } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Effect, Exit, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import type { Rbac } from '@qualy/rbac-contract/effect'
import { FormulaLibrary, layer as formulaLayer } from '../src/server/index.ts'
import { FormulaRuntimeStore, runtimeStoreLayer } from '../src/server/runtime-store.ts'
import { one, seedFormulaFixture, servicesFor } from './support/stack.ts'

// The runtime half held to its charter: resolution by exact identity, row
// integrity proven on every read, and nothing about the function's or its
// owner's CURRENT state consulted - a batch replays a version long after
// its author archived the function or the node it was written under was
// deleted. The signature itself is half the proof: resolve takes a tenant
// and a version UUID, no principal, and this file never touches the
// library's managed path after publication.

const stack = (url: string) =>
  Layer.mergeAll(
    formulaLayer.pipe(
      Layer.provide(sandboxLocalLayer({ size: 1, variant: 'release' })),
      Layer.provide(formulaAuthoringLocalLayer),
    ),
    runtimeStoreLayer,
  ).pipe(Layer.provideMerge(servicesFor(url)))

const run = <A, E>(
  url: string,
  effect: Effect.Effect<A, E, FormulaLibrary | FormulaRuntimeStore | Rbac | Orm>,
) => Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const IDENTITY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2 }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

describe.runIf(postgresAvailable)('the formula runtime store', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('formula-runtime-store')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('resolves what publication froze, and keeps proving it', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('rts-main')
          const library = yield* FormulaLibrary
          const store = yield* FormulaRuntimeStore
          const as = f.principal(f.admin)

          // the owner is a leaf node of its own, so deleting it later
          // orphans nothing else in the fixture
          const owner = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
              select ${f.t}, org_type_id, id, 'Leaf', path || 'leaf', 1
              from org_nodes where tenant_id = ${f.t} and parent_id is null
              returning id`),
          ).id
          const created = yield* library.createFunction(
            f.t,
            { ownerNodeId: owner, name: '认定分值', description: '' },
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
          yield* library.publish(f.t, created.id, drafted.draftRevision, as)
          const row = one<{
            id: string
            runtime_sha256: string
            contract_sha256: string
          }>(
            yield* runSql(sql`
              select id, runtime_sha256, contract_sha256
              from assessment_formula_versions where function_id = ${created.id}`),
          )

          // publication and the store speak the same identity function:
          // the round trip re-proves every hash on the way out
          const resolved = yield* store.resolve({ tenantId: f.t, versionId: row.id })

          // a wrong-tenant UUID reads as never having existed
          const foreign = yield* Effect.exit(
            store.resolve({ tenantId: randomUUID(), versionId: row.id }),
          )
          const absent = yield* Effect.exit(
            store.resolve({ tenantId: f.t, versionId: randomUUID() }),
          )

          // archive the function: the historical fact does not move
          yield* runSql(sql`
            update assessment_formula_functions set archived_at = now() where id = ${created.id}`)
          const afterArchive = yield* store.resolve({ tenantId: f.t, versionId: row.id })

          // delete the owner node: still not consulted
          yield* runSql(sql`delete from org_nodes where id = ${owner}`)
          const afterOwnerGone = yield* store.resolve({ tenantId: f.t, versionId: row.id })

          // tamper the artifact: the row no longer says what it said
          yield* runSql(sql`
            update assessment_formula_versions
            set runtime_js = runtime_js || '\n/*tampered*/' where id = ${row.id}`)
          const tamperedRuntime = yield* Effect.exit(
            store.resolve({ tenantId: f.t, versionId: row.id }),
          )
          yield* runSql(sql`
            update assessment_formula_versions
            set runtime_js = left(runtime_js, length(runtime_js) - length('\n/*tampered*/'))
            where id = ${row.id}`)

          // tamper the contract: widen a bound inside the stored schema
          yield* runSql(sql`
            update assessment_formula_versions
            set input_schema = jsonb_set(input_schema, '{properties,value,x-qualy-maximum}', '"99.00"')
            where id = ${row.id}`)
          const tamperedContract = yield* Effect.exit(
            store.resolve({ tenantId: f.t, versionId: row.id }),
          )

          return {
            row,
            resolved,
            foreign,
            absent,
            afterArchive,
            afterOwnerGone,
            tamperedRuntime,
            tamperedContract,
          }
        }),
      ),
    )
    expect(outcome.resolved.versionId).toBe(outcome.row.id)
    expect(outcome.resolved.runtimeSha256).toBe(outcome.row.runtime_sha256)
    expect(outcome.resolved.contractSha256).toBe(outcome.row.contract_sha256)
    expect(outcome.resolved.versionNo).toBe(1)
    expect(outcome.resolved.formulaAbiVersion).toBe(1)
    expect(outcome.resolved.runtimeJs.length).toBeGreaterThan(0)

    for (const missing of [outcome.foreign, outcome.absent]) {
      expect(Exit.isFailure(missing)).toBe(true)
      expect(inspect(missing, { depth: 6 })).toContain('ASSESSMENT_FORMULA_RUNTIME_MISSING')
    }

    expect(outcome.afterArchive.versionId).toBe(outcome.row.id)
    expect(outcome.afterOwnerGone.versionId).toBe(outcome.row.id)

    expect(Exit.isFailure(outcome.tamperedRuntime)).toBe(true)
    expect(inspect(outcome.tamperedRuntime, { depth: 6 })).toContain("field: 'runtime'")
    expect(Exit.isFailure(outcome.tamperedContract)).toBe(true)
    expect(inspect(outcome.tamperedContract, { depth: 6 })).toContain("field: 'contract'")
  }, 120_000)
})
