import { inspect } from 'node:util'
import { Effect, Exit, Fiber, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { transaction, type Orm } from '@qualy/plugin-database/server'
import { SOURCE_LIMIT } from '@qualy/sandbox-rpc'
import type { Rbac } from '@qualy/rbac-contract/effect'
import { FormulaTemplateLibrary, templateLibraryLayer } from '../src/server/template-library.ts'
import { one, seedFormulaFixture, servicesFor } from './support/stack.ts'
import { publishedVersion } from './support/versions.ts'

// Forking a template into a draft of your own.
//
// A snapshot, and the whole point is what does NOT follow it. What comes
// back is a draft with no version of its own: the source was compiled by a
// toolchain that has moved on, so its new author publishes it again in
// today's world or it never runs. Nothing about the original reaches it
// afterwards - not a rename, not an archival, not a withdrawal, not the
// next version its author publishes.
//
// And the visibility it is judged by is the same one the listing uses, held
// under the version row: a copy of something already taken back would be a
// hole shaped exactly like the decision it contradicts.

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

const offer = (tenantId: string, versionId: string, orgNodeId: string, by: string) =>
  runSql(sql`
    insert into assessment_formula_share_scopes (tenant_id, version_id, org_node_id, shared_by)
    values (${tenantId}, ${versionId}, ${orgNodeId}, ${by})`)

interface DraftRow {
  readonly id: string
  readonly name: string
  readonly created_by: string
  readonly updated_by: string
  readonly draft_source_ts: string
  readonly draft_tests: readonly Record<string, unknown>[]
  readonly draft_revision: number
  readonly copied_from_version_id: string | null
  readonly archived_at: string | null
}

const draftOf = (functionId: string) =>
  Effect.map(
    runSql(sql`select * from assessment_formula_functions where id = ${functionId}`),
    (result) => one<DraftRow>(result),
  )

describe.runIf(postgresAvailable)('forking a template', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('formula-template-copy')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('hands back a draft of my own, carrying the source and nothing else', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('copy-basic')
          const templates = yield* FormulaTemplateLibrary
          const published = yield* publishedVersion(f.t, f.authorA, '被复制的公式')
          yield* offer(f.t, published.versionId, f.root, f.authorA)

          const copied = yield* templates.copyTemplate(
            f.t,
            published.versionId,
            { userId: f.authorB, nodeId: f.collegeA },
            { name: '我的副本', description: '试试' },
          )
          const draft = yield* draftOf(copied.functionId)
          const source = yield* draftOf(published.functionId)
          const versions = one<{ count: string }>(
            yield* runSql(sql`
              select count(*)::text as count from assessment_formula_versions
              where function_id = ${copied.functionId}`),
          ).count
          const shares = one<{ count: string }>(
            yield* runSql(sql`
              select count(*)::text as count from assessment_formula_share_scopes
              where version_id in (select id from assessment_formula_versions
                                   where function_id = ${copied.functionId})`),
          ).count
          return { draft, source, versions, shares, authorB: f.authorB, published }
        }),
      ),
    )

    // it belongs to whoever forked it, from the first row
    expect(outcome.draft.created_by).toBe(outcome.authorB)
    expect(outcome.draft.updated_by).toBe(outcome.authorB)
    expect(outcome.draft.name).toBe('我的副本')
    expect(outcome.draft.archived_at).toBeNull()
    // the source it starts from is exactly what was published
    expect(outcome.draft.draft_source_ts).toBe(outcome.source.draft_source_ts)
    expect(outcome.draft.draft_tests).toEqual(outcome.source.draft_tests)
    expect(outcome.draft.draft_revision).toBe(1)
    // and it says where it came from, exactly
    expect(outcome.draft.copied_from_version_id).toBe(outcome.published.versionId)
    // a draft, not a publication: nothing ran, nothing was minted
    expect(outcome.versions).toBe('0')
    expect(outcome.shares).toBe('0')
  }, 120_000)

  it('leaves the two apart once the fork is made', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('copy-apart')
          const templates = yield* FormulaTemplateLibrary
          const published = yield* publishedVersion(f.t, f.authorA, '原公式')
          yield* offer(f.t, published.versionId, f.root, f.authorA)
          const copied = yield* templates.copyTemplate(
            f.t,
            published.versionId,
            { userId: f.authorB, nodeId: f.collegeA },
            { name: '副本' },
          )

          // the fork moves
          yield* runSql(sql`
            update assessment_formula_functions
            set draft_source_ts = 'export const mine = 1', name = '改过的副本'
            where id = ${copied.functionId}`)
          const sourceAfterForkEdit = yield* draftOf(published.functionId)

          // and everything the original does afterwards
          yield* runSql(sql`
            update assessment_formula_functions
            set name = '改名的原公式', archived_at = now()
            where id = ${published.functionId}`)
          yield* runSql(sql`
            delete from assessment_formula_share_scopes where version_id = ${published.versionId}`)
          const forkAfterSourceMoved = yield* draftOf(copied.functionId)

          return { sourceAfterForkEdit, forkAfterSourceMoved, published }
        }),
      ),
    )

    // editing the fork left the original alone
    expect(outcome.sourceAfterForkEdit.name).toBe('原公式')
    expect(outcome.sourceAfterForkEdit.draft_source_ts).toBe('export {}')
    // renaming, archiving and withdrawing the original left the fork alone,
    // and it still says where it came from
    expect(outcome.forkAfterSourceMoved.name).toBe('改过的副本')
    expect(outcome.forkAfterSourceMoved.draft_source_ts).toBe('export const mine = 1')
    expect(outcome.forkAfterSourceMoved.copied_from_version_id).toBe(outcome.published.versionId)
    expect(outcome.forkAfterSourceMoved.archived_at).toBeNull()
  }, 120_000)

  it('copies only what it could discover, by the very same rule', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('copy-visible')
          const templates = yield* FormulaTemplateLibrary
          const published = yield* publishedVersion(f.t, f.authorA, '公式')
          const viewer = { userId: f.authorB, nodeId: f.collegeA }

          // never offered
          const unoffered = yield* Effect.exit(
            templates.copyTemplate(f.t, published.versionId, viewer, { name: 'x' }),
          )
          yield* offer(f.t, published.versionId, f.root, f.authorA)
          // their own work is not a template to them, even by id
          const own = yield* Effect.exit(
            templates.copyTemplate(
              f.t,
              published.versionId,
              { userId: f.authorA, nodeId: f.collegeA },
              {
                name: 'x',
              },
            ),
          )
          // standing nowhere reaches nothing
          const nowhere = yield* Effect.exit(
            templates.copyTemplate(
              f.t,
              published.versionId,
              { userId: f.authorB, nodeId: null },
              {
                name: 'x',
              },
            ),
          )
          return { unoffered: tagOf(unoffered), own: tagOf(own), nowhere: tagOf(nowhere) }
        }),
      ),
    )

    for (const tag of [outcome.unoffered, outcome.own, outcome.nowhere]) {
      expect(tag).toBe('ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND')
    }
  }, 120_000)

  it('refuses to fork a source no draft may hold today', async () => {
    // A version published when the ceiling was wider stays replayable
    // forever - that is what publication means - but it must not become a
    // draft that breaks the ceiling drafts are held to now. Copying is a
    // way of creating one, so it holds the same service invariant every
    // other way of creating one does.
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('copy-oversize')
          const templates = yield* FormulaTemplateLibrary
          const published = yield* publishedVersion(f.t, f.authorA, '超大公式')
          yield* offer(f.t, published.versionId, f.root, f.authorA)
          const oversized = `export {}${'x'.repeat(SOURCE_LIMIT)}`
          yield* runSql(sql`
            update assessment_formula_versions set source_ts = ${oversized}
            where id = ${published.versionId}`)
          return tagOf(
            yield* Effect.exit(
              templates.copyTemplate(
                f.t,
                published.versionId,
                { userId: f.authorB, nodeId: f.collegeA },
                { name: '副本' },
              ),
            ),
          )
        }),
      ),
    )
    expect(outcome).toBe('ASSESSMENT_FORMULA_SOURCE_TOO_LARGE')
  }, 120_000)

  it('linearizes against a withdrawal instead of racing it', async () => {
    // The version row is held FOR SHARE while the audience is read and the
    // draft written, so a concurrent withdrawal waits its turn rather than
    // landing between the two. Read committed would otherwise let a copy of
    // something already taken back go through.
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('copy-race')
          const templates = yield* FormulaTemplateLibrary
          const published = yield* publishedVersion(f.t, f.authorA, '争用公式')
          yield* offer(f.t, published.versionId, f.root, f.authorA)

          // a withdrawal that takes the version row FOR UPDATE first, the
          // way the sharing writer does
          const contender = yield* Effect.forkChild(
            Effect.promise(async () => {
              const started = Date.now()
              await db.query(
                `update assessment_formula_versions set published_at = published_at where id = $1`,
                [published.versionId],
              )
              await db.query(`delete from assessment_formula_share_scopes where version_id = $1`, [
                published.versionId,
              ])
              return Date.now() - started
            }),
          )

          const copied = yield* transaction(
            Effect.gen(function* () {
              const made = yield* templates.copyTemplate(
                f.t,
                published.versionId,
                { userId: f.authorB, nodeId: f.collegeA },
                { name: '抢到的副本' },
              )
              yield* Effect.promise(() => new Promise((done) => setTimeout(done, 300)))
              return made
            }),
          )
          const waitedMs = yield* Fiber.join(contender)

          // and once the withdrawal lands, the same copy is refused
          const after = yield* Effect.exit(
            templates.copyTemplate(
              f.t,
              published.versionId,
              { userId: f.authorB, nodeId: f.collegeA },
              { name: '晚到的副本' },
            ),
          )
          return { copied, waitedMs, after: tagOf(after) }
        }),
      ),
    )

    expect(outcome.copied.functionId).toEqual(expect.any(String))
    // the withdrawal could not land while the copy held the version row
    expect(outcome.waitedMs).toBeGreaterThan(150)
    expect(outcome.after).toBe('ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND')
  }, 120_000)
})
