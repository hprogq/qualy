import { inspect } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Effect, Exit, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import type { Rbac } from '@qualy/rbac-contract/effect'
import {
  FormulaTemplateLibrary,
  templateLibraryLayer,
  type TemplatePage,
} from '../src/server/template-library.ts'
import { one, seedFormulaFixture, servicesFor } from './support/stack.ts'
import { addVersion, publishedVersion } from './support/versions.ts'

// What one author may discover of what another offered.
//
// An audience is a place: a share row names a unit, and it reaches everybody
// standing at that unit or under it. The reader's own work is never a
// template to them - it is already in their library - and standing nowhere
// reaches nothing rather than everything.
//
// The same predicate answers the listing and the detail, on purpose. A
// version somebody can name but not discover is not a template to them, and
// telling them apart from one that does not exist would let anybody holding
// a uuid learn whether it does.

const stack = (url: string) => templateLibraryLayer.pipe(Layer.provideMerge(servicesFor(url)))

const run = <A, E>(url: string, effect: Effect.Effect<A, E, FormulaTemplateLibrary | Rbac | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url) as never) as Effect.Effect<A, E>)

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const tagOf = (exit: Exit.Exit<unknown, unknown>): string => {
  const rendered = inspect(exit, { depth: 10 })
  const match = /_tag: '([A-Z_]+)'/.exec(rendered)
  return match?.[1] ?? rendered
}

/** offers one published version to one unit, the way the service would */
const offer = (tenantId: string, versionId: string, orgNodeId: string, by: string) =>
  runSql(sql`
    insert into assessment_formula_share_scopes (tenant_id, version_id, org_node_id, shared_by)
    values (${tenantId}, ${versionId}, ${orgNodeId}, ${by})`)

describe.runIf(postgresAvailable)('discovering a shared formula', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('formula-template-discovery')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('reaches everybody under the unit it was offered to, and nobody beside it', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('tpl-audience')
          const templates = yield* FormulaTemplateLibrary
          // a sibling college, and somebody standing in it
          const collegeB = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
              select ${f.t}, org_type_id, id, 'College B', path || 'b', 1
              from org_nodes where tenant_id = ${f.t} and parent_id is null
              returning id`),
          ).id
          yield* runSql(sql`
            update users set primary_org_node_id = ${collegeB} where id = ${f.authorB}`)

          const published = yield* publishedVersion(f.t, f.authorA, '共享公式')
          const second = yield* addVersion(f.t, published.functionId, f.authorA, 2)
          yield* offer(f.t, published.versionId, f.collegeA, f.authorA)

          // somebody standing in college A - the fixture's own bystander
          const insider = { userId: f.bystander, nodeId: f.collegeA }
          const outsider = { userId: f.authorB, nodeId: collegeB }
          const author = { userId: f.authorA, nodeId: f.collegeA }
          const nowhere = { userId: f.bystander, nodeId: null }

          return {
            insider: (yield* templates.listTemplates(f.t, insider)).items.map(
              (row) => row.versionId,
            ),
            outsider: (yield* templates.listTemplates(f.t, outsider)).items.length,
            author: (yield* templates.listTemplates(f.t, author)).items.length,
            nowhere: (yield* templates.listTemplates(f.t, nowhere)).items.length,
            offered: published.versionId,
            unoffered: second,
          }
        }),
      ),
    )

    // exactly the version that was offered - the one published beside it is
    // a different fact and was never offered
    expect(outcome.insider).toEqual([outcome.offered])
    expect(outcome.insider).not.toContain(outcome.unoffered)
    // a sibling unit is not under the one named
    expect(outcome.outsider).toBe(0)
    // their own work is not a template to them
    expect(outcome.author).toBe(0)
    // standing nowhere reaches nothing, not everything
    expect(outcome.nowhere).toBe(0)
  }, 120_000)

  it('reaches the whole tenant when the offer names its root', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('tpl-root')
          const templates = yield* FormulaTemplateLibrary
          const published = yield* publishedVersion(f.t, f.authorA, '全租户公式')
          yield* offer(f.t, published.versionId, f.root, f.authorA)
          return {
            deep: (yield* templates.listTemplates(f.t, {
              userId: f.authorB,
              nodeId: f.collegeA,
            })).items.map((row) => row.versionId),
            offered: published.versionId,
          }
        }),
      ),
    )
    expect(outcome.deep).toEqual([outcome.offered])
  }, 120_000)

  it('keeps offering what an archived function published, and says so', async () => {
    // archival stops a function being offered for NEW configuration of its
    // author's own questions; it says nothing about the audience its
    // published versions already carry. Withdrawing that is a separate act.
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('tpl-archived')
          const templates = yield* FormulaTemplateLibrary
          const published = yield* publishedVersion(f.t, f.authorA, '归档来源')
          yield* offer(f.t, published.versionId, f.root, f.authorA)
          const viewer = { userId: f.authorB, nodeId: f.collegeA }
          const live = yield* templates.listTemplates(f.t, viewer)

          yield* runSql(sql`
            update assessment_formula_functions set archived_at = now()
            where id = ${published.functionId}`)
          const archived = yield* templates.listTemplates(f.t, viewer)
          const detail = yield* templates.getTemplate(f.t, published.versionId, viewer)

          // and taking the offer back removes it from both reads
          yield* runSql(sql`
            delete from assessment_formula_share_scopes where version_id = ${published.versionId}`)
          const withdrawn = yield* templates.listTemplates(f.t, viewer)
          const gone = yield* Effect.exit(templates.getTemplate(f.t, published.versionId, viewer))
          return {
            live: live.items.map((row) => row.sourceStatus),
            archived: archived.items.map((row) => row.sourceStatus),
            detailStatus: detail.sourceStatus,
            detailSource: detail.sourceTs,
            withdrawn: withdrawn.items.length,
            gone: tagOf(gone),
          }
        }),
      ),
    )

    expect(outcome.live).toEqual(['active'])
    expect(outcome.archived).toEqual(['archived'])
    expect(outcome.detailStatus).toBe('archived')
    // the detail carries what a reader has to see to decide whether to copy
    expect(outcome.detailSource).toBe('export {}')
    expect(outcome.withdrawn).toBe(0)
    expect(outcome.gone).toBe('ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND')
  }, 120_000)

  it('answers a version nobody offered exactly as it answers one nobody has', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('tpl-absent')
          const templates = yield* FormulaTemplateLibrary
          const unoffered = yield* publishedVersion(f.t, f.authorA, '没共享的')
          const viewer = { userId: f.authorB, nodeId: f.collegeA }
          return {
            unoffered: tagOf(
              yield* Effect.exit(templates.getTemplate(f.t, unoffered.versionId, viewer)),
            ),
            invented: tagOf(yield* Effect.exit(templates.getTemplate(f.t, randomUUID(), viewer))),
            nowhere: tagOf(
              yield* Effect.exit(
                templates.getTemplate(f.t, unoffered.versionId, {
                  userId: f.authorB,
                  nodeId: null,
                }),
              ),
            ),
          }
        }),
      ),
    )
    // one answer for every way of not being a template here: telling them
    // apart would let anybody holding a uuid learn whether it exists
    expect(outcome.unoffered).toBe('ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND')
    expect(outcome.invented).toBe('ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND')
    expect(outcome.nowhere).toBe('ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND')
  }, 120_000)

  it('lists a template whose author is gone, and walks every page once', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('tpl-paging')
          const templates = yield* FormulaTemplateLibrary
          const planted: string[] = []
          for (let no = 1; no <= 5; no += 1) {
            const published = yield* publishedVersion(f.t, f.authorA, `公式 ${no}`)
            yield* offer(f.t, published.versionId, f.root, f.authorA)
            planted.push(published.versionId)
          }
          // the author's row goes; authorship carries no foreign key, and a
          // template must not vanish because the row naming it did
          yield* runSql(sql`delete from role_grants where user_id = ${f.authorA}`)
          yield* runSql(sql`delete from users where id = ${f.authorA}`)

          const viewer = { userId: f.authorB, nodeId: f.collegeA }
          const walked: string[] = []
          let after: { publishedAt: string; versionId: string } | undefined = undefined
          for (let page = 0; page < 20; page += 1) {
            const got: TemplatePage = yield* templates.listTemplates(f.t, viewer, {
              limit: 2,
              after,
            })
            walked.push(...got.items.map((row) => row.versionId))
            if (!got.more || got.last === null) break
            after = got.last
          }
          const whole = yield* templates.listTemplates(f.t, viewer, { limit: 100 })
          return {
            walked,
            planted,
            names: whole.items.map((row) => row.authorName),
            authors: whole.items.map((row) => row.authorUserId),
            authorA: f.authorA,
          }
        }),
      ),
    )

    expect([...outcome.walked].sort()).toEqual([...outcome.planted].sort())
    // the template stands; the name it cannot resolve is simply absent
    expect(outcome.names).toEqual([null, null, null, null, null])
    expect(new Set(outcome.authors)).toEqual(new Set([outcome.authorA]))
  }, 120_000)
})
