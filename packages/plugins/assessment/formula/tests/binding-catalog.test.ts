import { inspect } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Effect, Exit, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { configurationAccessLayer } from '@qualy/plugin-assessment/server/configuration-access'
import {
  normalizeAtomicSchema,
  normalizeInputSchema,
  VALUE_SCHEMA_PROFILE_VERSION,
} from '@qualy/value-schema'
import {
  BindableFormulaCatalog,
  bindingCatalogLayer,
  type FormulaNotBindable,
} from '../src/server/binding-catalog.ts'
import { FormulaRuntimeStore, runtimeStoreLayer } from '../src/server/runtime-store.ts'
import { contractIdentityOf, sha256Hex } from '../src/server/contract-identity.ts'
import { one, seedFormulaFixture, servicesFor } from './support/stack.ts'

// New-binding eligibility as a read model of facts - no principal in either
// signature, because the item update already authorized its administrator
// and 7.3's calculator compiles with no principal at all. The rule: the
// owner node must cover EVERY frozen management anchor; an archived
// function, a deleted owner, an unresolvable anchor, an absent version or a
// boundary with no anchors each fails closed under its own name. And on the
// same rows, the runtime store keeps answering - the two services parting
// ways on one fixture is the continuation/new-binding split made flesh.

const stack = (url: string) =>
  Layer.mergeAll(
    runtimeStoreLayer,
    bindingCatalogLayer.pipe(Layer.provide(configurationAccessLayer)),
  ).pipe(Layer.provideMerge(servicesFor(url)))

const run = <A, E>(
  url: string,
  effect: Effect.Effect<A, E, BindableFormulaCatalog | FormulaRuntimeStore | Orm>,
) => Effect.runPromiseExit(Effect.provide(effect, stack(url) as never) as Effect.Effect<A, E>)

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const reasonOf = (exit: Exit.Exit<unknown, FormulaNotBindable>) => {
  if (!Exit.isFailure(exit)) throw new Error('expected a refusal')
  const rendered = inspect(exit, { depth: 8 })
  const match = /reason: '([a-z-]+)'/.exec(rendered)
  return match?.[1] ?? rendered
}

const CONTRACT = {
  input: normalizeInputSchema({
    type: 'object',
    properties: { level: { type: 'string', enum: ['national', 'provincial'] } },
    required: ['level'],
    additionalProperties: false,
  }),
  output: normalizeAtomicSchema({
    type: 'string',
    format: 'qualy-decimal',
    'x-qualy-maxScale': 2,
    'x-qualy-minimum': '-99999999.99',
    'x-qualy-maximum': '99999999.99',
  }),
}

describe.runIf(postgresAvailable)('the bindable formula catalog', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('formula-binding-catalog')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('answers eligibility from the boundary and the owner, and parts ways with replay', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('bind-cat')
          const catalog = yield* BindableFormulaCatalog
          const store = yield* FormulaRuntimeStore

          // a second college beside fixture's college A, plus batches
          const collegeB = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
              select ${f.t}, org_type_id, id, 'College B', path || 'b', 1
              from org_nodes where tenant_id = ${f.t} and parent_id is null
              returning id`),
          ).id
          const batch = (name: string, anchors: readonly string[]) =>
            Effect.gen(function* () {
              const id = one<{ id: string }>(
                yield* runSql(sql`
                  insert into assessment_batches (tenant_id, name, material_range)
                  values (${f.t}, ${name}, daterange('2026-03-01', '2026-09-01')) returning id`),
              ).id
              for (const anchor of anchors) {
                yield* runSql(sql`
                  insert into batch_management_anchors (tenant_id, batch_id, org_node_id)
                  values (${f.t}, ${id}, ${anchor})`)
              }
              return id
            })
          const root = one<{ id: string }>(
            yield* runSql(
              sql`select id from org_nodes where tenant_id = ${f.t} and parent_id is null`,
            ),
          ).id
          const batchA = yield* batch('Round A', [f.collegeA])
          const batchAB = yield* batch('Round A+B', [f.collegeA, collegeB])
          const anchorless = yield* batch('Leftover', [])

          // three formulas: tenant-root owned, college-A owned, college-B owned
          const identity = contractIdentityOf(CONTRACT.input, CONTRACT.output)
          const artifact = '/*artifact*/'
          const publish = (ownerNodeId: string, name: string) =>
            Effect.gen(function* () {
              const functionId = one<{ id: string }>(
                yield* runSql(sql`
                  insert into assessment_formula_functions
                    (tenant_id, owner_node_id, name, draft_source_ts, draft_tests, created_by, updated_by)
                  values (${f.t}, ${ownerNodeId}, ${name}, 'export {}', '[]'::jsonb, ${f.admin}, ${f.admin})
                  returning id`),
              ).id
              const versionId = one<{ id: string }>(
                yield* runSql(sql`
                  insert into assessment_formula_versions
                    (tenant_id, function_id, version_no, source_ts, runtime_js,
                     input_schema, output_schema, source_sha256, runtime_sha256, contract_sha256,
                     typescript_version, esbuild_version, formula_abi_version, formula_runtime_sha256,
                     quickjs_engine_version, tests, test_report, published_by,
                     value_schema_profile_version)
                  values (${f.t}, ${functionId}, 1, 'export {}', ${artifact},
                          ${JSON.stringify(CONTRACT.input)}::jsonb, ${JSON.stringify(CONTRACT.output)}::jsonb,
                          ${sha256Hex('export {}')}, ${sha256Hex(artifact)}, ${identity.contractSha256},
                          '7.0.0', '0.28.0', 1, ${sha256Hex('runtime')},
                          'quickjs-test', '[]'::jsonb, '[]'::jsonb, ${f.admin},
                          ${VALUE_SCHEMA_PROFILE_VERSION})
                  returning id`),
              ).id
              return { functionId, versionId }
            })
          const rootFormula = yield* publish(root, '校级公式')
          const collegeAFormula = yield* publish(f.collegeA, 'A 院公式')
          const collegeBFormula = yield* publish(collegeB, 'B 院公式')

          const listA = yield* catalog.listForBatch(f.t, batchA)
          const listAB = yield* catalog.listForBatch(f.t, batchAB)
          const bindRootOnA = yield* catalog.requireBindable(f.t, batchA, rootFormula.versionId)
          const bindAOnA = yield* catalog.requireBindable(f.t, batchA, collegeAFormula.versionId)
          const bindBOnA = yield* Effect.exit(
            catalog.requireBindable(f.t, batchA, collegeBFormula.versionId),
          )
          const unknownBatch = yield* Effect.exit(
            catalog.requireBindable(f.t, randomUUID(), rootFormula.versionId),
          )
          const unknownVersion = yield* Effect.exit(
            catalog.requireBindable(f.t, batchA, randomUUID()),
          )
          const zeroAnchors = yield* Effect.exit(
            catalog.requireBindable(f.t, anchorless, rootFormula.versionId),
          )

          // archive college A's function: replay keeps answering, new
          // binding stops - the same row, two different rights
          yield* runSql(sql`
            update assessment_formula_functions set archived_at = now()
            where id = ${collegeAFormula.functionId}`)
          const archivedResolve = yield* store.resolve({
            tenantId: f.t,
            versionId: collegeAFormula.versionId,
          })
          const archivedBind = yield* Effect.exit(
            catalog.requireBindable(f.t, batchA, collegeAFormula.versionId),
          )
          const listAfterArchive = yield* catalog.listForBatch(f.t, batchA)

          // delete college B's owner node: same split
          yield* runSql(sql`
            update assessment_formula_functions set archived_at = null
            where id = ${collegeAFormula.functionId}`)
          const ownerlessTarget = yield* publish(collegeB, 'B 院第二式')
          yield* runSql(sql`delete from batch_management_anchors where org_node_id = ${collegeB}`)
          yield* runSql(sql`
            delete from org_nodes where id = ${collegeB}`)
          const ownerGoneResolve = yield* store.resolve({
            tenantId: f.t,
            versionId: ownerlessTarget.versionId,
          })
          const ownerGoneBind = yield* Effect.exit(
            catalog.requireBindable(f.t, batchA, ownerlessTarget.versionId),
          )

          return {
            listA: listA.map((v) => v.functionName),
            listAB: listAB.map((v) => v.functionName),
            bindRootOnA,
            bindAOnA,
            bindBOnA,
            unknownBatch,
            unknownVersion,
            zeroAnchors,
            archivedResolve,
            archivedBind,
            listAfterArchive: listAfterArchive.map((v) => v.functionName),
            ownerGoneResolve,
            ownerGoneBind,
            versionIds: { root: rootFormula.versionId, a: collegeAFormula.versionId },
          }
        }),
      ),
    )
    // the boundary rule, universally quantified over anchors
    expect(outcome.listA.sort()).toEqual(['A 院公式', '校级公式'])
    expect(outcome.listAB).toEqual(['校级公式'])
    expect(outcome.bindRootOnA.versionId).toBe(outcome.versionIds.root)
    expect(outcome.bindAOnA.versionId).toBe(outcome.versionIds.a)
    expect(reasonOf(outcome.bindBOnA)).toBe('outside-management-boundary')
    // each refusal under its own name, never collapsed
    expect(reasonOf(outcome.unknownBatch)).toBe('batch-not-found')
    expect(reasonOf(outcome.unknownVersion)).toBe('version-not-found')
    expect(reasonOf(outcome.zeroAnchors)).toBe('no-management-boundary')
    // the split: replay answers, new binding refuses - same rows
    expect(outcome.archivedResolve.versionId).toBe(outcome.versionIds.a)
    expect(reasonOf(outcome.archivedBind)).toBe('function-archived')
    expect(outcome.listAfterArchive).toEqual(['校级公式'])
    expect(outcome.ownerGoneResolve.runtimeJs).toBe('/*artifact*/')
    expect(reasonOf(outcome.ownerGoneBind)).toBe('owner-node-missing')
  }, 120_000)
})
