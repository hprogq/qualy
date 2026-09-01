import { inspect } from 'node:util'
import { Effect, Exit, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import type { Rbac } from '@qualy/rbac-contract/effect'
import { FormulaTemplateLibrary, templateLibraryLayer } from '../src/server/template-library.ts'
import { BindableFormulaCatalog, bindingCatalogLayer } from '../src/server/binding-catalog.ts'
import { formulaAuthoringPolicy } from '../src/scoring/authoring-policy.ts'
import { one, seedFormulaFixture, servicesFor } from './support/stack.ts'
import { addVersion, publishedVersion } from './support/versions.ts'

// The line between being offered something and being allowed to run it.
//
// Sharing hands over discovery and a copy. It never hands over the right to
// point a question at somebody else's published version - that stays with
// whoever wrote it, and a fork is how a reader gets a program they may
// bind. This file bears exactly the two halves of that: what stays refused
// however widely it was offered, and what the fork actually buys.

const stack = (url: string) =>
  Layer.mergeAll(templateLibraryLayer, bindingCatalogLayer).pipe(
    Layer.provideMerge(servicesFor(url)),
  )

const run = <A, E>(
  url: string,
  effect: Effect.Effect<A, E, FormulaTemplateLibrary | BindableFormulaCatalog | Rbac | Orm>,
) => Effect.runPromiseExit(Effect.provide(effect, stack(url) as never) as Effect.Effect<A, E>)

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const offer = (tenantId: string, versionId: string, orgNodeId: string, by: string) =>
  runSql(sql`
    insert into assessment_formula_share_scopes (tenant_id, version_id, org_node_id, shared_by)
    values (${tenantId}, ${versionId}, ${orgNodeId}, ${by})`)

/** the same question a save asks, asked directly of the seam that answers it */
const mayBind = (tenantId: string, versionId: string, userId: string) =>
  Effect.gen(function* () {
    const policy = yield* formulaAuthoringPolicy.bind
    return yield* policy
      .authorize({
        tenantId,
        principal: { tenantId, userId, sessionId: 's' },
        config: { versionId },
        previousRuntimeRef: undefined,
      } as never)
      .pipe(
        Effect.as('allowed' as string),
        Effect.catch((issue: unknown) => Effect.succeed((issue as { reason: string }).reason)),
      )
  })

describe.runIf(postgresAvailable)('what a shared formula does and does not grant', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('formula-fork-isolation')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('stays unbindable however widely it was offered, and the fork is what changes that', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('fork-line')
          const templates = yield* FormulaTemplateLibrary
          const catalog = yield* BindableFormulaCatalog
          // B stands under the unit A offers to
          yield* runSql(sql`
            update users set primary_org_node_id = ${f.collegeA} where id = ${f.authorB}`)
          const viewer = { userId: f.authorB, nodeId: f.collegeA }

          const published = yield* publishedVersion(f.t, f.authorA, '共享但不可绑')
          yield* offer(f.t, published.versionId, f.collegeA, f.authorA)

          // B can see it, all the way to the source
          const listed = (yield* templates.listTemplates(f.t, viewer)).items.map(
            (row) => row.versionId,
          )
          // and still may not point a question at it - discovery is not a
          // right to run somebody else's program
          const beforeFork = yield* mayBind(f.t, published.versionId, f.authorB)
          // nor is it offered to B as a binding choice
          const offeredToB = (yield* catalog.listForBatch(f.t, f.authorB)).items.length
          // its author, meanwhile, binds their own
          const forAuthor = yield* mayBind(f.t, published.versionId, f.authorA)

          // B forks it and publishes the fork under their own name
          const copy = yield* templates.copyTemplate(
            f.t,
            published.versionId,
            viewer,
            { name: '我的分叉' },
          )
          const forked = yield* addVersion(f.t, copy.functionId, f.authorB, 1)
          yield* runSql(sql`
            update assessment_formula_versions set published_at = now() where id = ${forked}`)

          return {
            listed,
            offered: published.versionId,
            beforeFork,
            offeredToB,
            forAuthor,
            // the fork is B's own program, by the same rule that refused the original
            forkBindable: yield* mayBind(f.t, forked, f.authorB),
            // and it is B's, not A's
            forkForAuthorA: yield* mayBind(f.t, forked, f.authorA),
            // it is in B's picker now, and A's version still is not
            pickerForB: (yield* catalog.listForBatch(f.t, f.authorB)).items.map(
              (row) => row.versionId,
            ),
            forkedVersion: forked,
          }
        }),
      ),
    )

    expect(outcome.listed).toEqual([outcome.offered])
    expect(outcome.beforeFork).toBe('formula-not-yours')
    expect(outcome.offeredToB).toBe(0)
    expect(outcome.forAuthor).toBe('allowed')
    expect(outcome.forkBindable).toBe('allowed')
    expect(outcome.forkForAuthorA).toBe('formula-not-yours')
    // exactly the fork - never the version it was taken from
    expect(outcome.pickerForB).toEqual([outcome.forkedVersion])
  }, 120_000)

  it('leaves a fork standing when the offer behind it is taken back', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('fork-withdrawn')
          const templates = yield* FormulaTemplateLibrary
          yield* runSql(sql`
            update users set primary_org_node_id = ${f.collegeA} where id = ${f.authorB}`)
          const viewer = { userId: f.authorB, nodeId: f.collegeA }

          const published = yield* publishedVersion(f.t, f.authorA, '收回的共享')
          yield* offer(f.t, published.versionId, f.collegeA, f.authorA)
          const copy = yield* templates.copyTemplate(
            f.t,
            published.versionId,
            viewer,
            { name: '仍然是我的' },
          )
          const forked = yield* addVersion(f.t, copy.functionId, f.authorB, 1)

          // A withdraws the offer and archives the source behind it
          yield* runSql(sql`
            delete from assessment_formula_share_scopes where version_id = ${published.versionId}`)
          yield* runSql(sql`
            update assessment_formula_functions set archived_at = now()
            where id = ${published.functionId}`)

          const row = one<{ name: string; created_by: string; copied_from_version_id: string }>(
            yield* runSql(sql`
              select name, created_by, copied_from_version_id
              from assessment_formula_functions where id = ${copy.functionId}`),
          )
          return {
            gone: (yield* templates.listTemplates(f.t, viewer)).items.length,
            name: row.name,
            createdBy: row.created_by,
            provenance: row.copied_from_version_id,
            source: published.versionId,
            authorB: f.authorB,
            stillBindable: yield* mayBind(f.t, forked, f.authorB),
          }
        }),
      ),
    )

    // the library forgets it; nothing else does
    expect(outcome.gone).toBe(0)
    expect(outcome.name).toBe('仍然是我的')
    expect(outcome.createdBy).toBe(outcome.authorB)
    // provenance is a fact about where this draft came from, and survives
    // the withdrawal of the offer that made it possible
    expect(outcome.provenance).toBe(outcome.source)
    expect(outcome.stillBindable).toBe('allowed')
  }, 120_000)
})
