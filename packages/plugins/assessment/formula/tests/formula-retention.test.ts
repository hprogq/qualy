import { inspect } from 'node:util'
import { Effect, Exit, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import type { Rbac } from '@qualy/rbac-contract/effect'
import {
  FormulaLibrary,
  KEPT_DRAFT_REVISIONS,
  KEPT_DRAFT_REVISION_BYTES,
  layer as formulaLayer,
} from '../src/server/index.ts'
import { seedFormulaFixture, servicesFor } from './support/stack.ts'

// How much draft history one formula keeps. Every save keeps a whole
// snapshot, so the history is bounded formula by formula: the current draft
// and the revision each publication came from always stay, the oldest of
// the rest go once a formula holds more than it keeps, and a write to one
// formula never takes anything from another.

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

const rows = <T>(result: unknown) => (result as { rows: T[] }).rows

const IDENTITY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2, title: '分值' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

const THREE = [{ name: 'three', input: { value: '3.00' }, expected: '3' }]

/** a formula's revision numbers as they stand, oldest first */
const revisionsOf = (functionId: string) =>
  runSql(sql`
    select revision_no from assessment_formula_draft_revisions
     where function_id = ${functionId}
     order by revision_no`).pipe(
    Effect.map((result) => rows<{ revision_no: number }>(result).map((row) => row.revision_no)),
  )

/** saves nobody made through the service, standing in for months of work */
const earlierSaves = (input: {
  readonly t: string
  readonly functionId: string
  readonly savedBy: string
  readonly from: number
  readonly to: number
  /** a revision number that is left out, for the caller to fill */
  readonly skip?: number
  /** how long each saved source is, in bytes; short by default */
  readonly bytes?: number
}) =>
  Effect.gen(function* () {
    const source =
      input.bytes === undefined
        ? sql<string>`'// ' || n::text`
        : sql<string>`lpad(n::text, ${input.bytes}::int, 'x')`
    yield* runSql(sql`
      insert into assessment_formula_draft_revisions
        (tenant_id, function_id, revision_no, source_ts, tests, source_sha256, saved_by, origin)
      select ${input.t}, ${input.functionId}, n, ${source}, '[]'::jsonb,
             md5(n::text) || md5(n::text), ${input.savedBy}, 'saved'
        from generate_series(${input.from}::int, ${input.to}::int) as n
       where n <> ${input.skip ?? -1}::int`)
    // the draft is where the last of them left it
    yield* runSql(sql`
      update assessment_formula_functions f
         set draft_revision = ${input.to}::int,
             draft_source_ts = r.source_ts,
             draft_tests = r.tests
        from assessment_formula_draft_revisions r
       where r.function_id = f.id and r.revision_no = ${input.to}::int
         and f.id = ${input.functionId}`)
  })

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index)

describe.runIf(postgresAvailable)('how much draft history a formula keeps', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-formula-retention')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('keeps the current draft and what each version was published from, and lets the oldest of the rest go', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('fr-count')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const kept = yield* library.createFunction(f.t, { name: '写得多的公式' }, as)
          yield* library.updateDraft(
            f.t,
            kept.id,
            { expectedDraftRevision: 1, draftSourceTs: IDENTITY, draftTests: THREE },
            as,
          )
          const published = yield* library.publish(
            f.t,
            kept.id,
            { expectedDraftRevision: 2, releaseName: '第一版' },
            as,
          )
          const versionsBefore = rows<Record<string, unknown>>(
            yield* runSql(sql`
              select id, version_no, source_ts, tests::text as tests, runtime_js, published_at
                from assessment_formula_versions where function_id = ${kept.id}`),
          )
          // long after the publication: many more saves, one of them a
          // restore of the published version holding exactly its bytes
          yield* earlierSaves({
            t: f.t,
            functionId: kept.id,
            savedBy: f.admin,
            from: 3,
            to: 70,
            skip: 10,
          })
          yield* runSql(sql`
            insert into assessment_formula_draft_revisions
              (tenant_id, function_id, revision_no, source_ts, tests, source_sha256, saved_by,
               origin, source_version_id)
            select tenant_id, function_id, 10, source_ts, tests, source_sha256, saved_by,
                   'restored-from-version', ${published.versionId}
              from assessment_formula_draft_revisions
             where function_id = ${kept.id} and revision_no = 2`)

          // two other formulas of the same author: one holding only its
          // draft, one with a long history of its own
          const only = yield* library.createFunction(f.t, { name: '只有草稿' }, as)
          const long = yield* library.createFunction(f.t, { name: '历史很长' }, as)
          yield* earlierSaves({ t: f.t, functionId: long.id, savedBy: f.admin, from: 2, to: 80 })

          const beforeSave = yield* revisionsOf(kept.id)
          const saved = yield* library.updateDraft(
            f.t,
            kept.id,
            { expectedDraftRevision: 70, draftSourceTs: '// 71' },
            as,
          )
          const afterSave = yield* revisionsOf(kept.id)
          // a restore is a write of its own, and weighs the history again
          const restored = yield* library.restoreDraft(
            f.t,
            kept.id,
            { expectedDraftRevision: 71, from: { kind: 'published-version', versionNo: 1 } },
            as,
          )
          const afterRestore = yield* revisionsOf(kept.id)
          const publishedFrom = yield* library.getDraftRevision(f.t, kept.id, 2, as)
          const versionsAfter = rows<Record<string, unknown>>(
            yield* runSql(sql`
              select id, version_no, source_ts, tests::text as tests, runtime_js, published_at
                from assessment_formula_versions where function_id = ${kept.id}`),
          )
          return {
            beforeSave,
            saved,
            afterSave,
            restored,
            afterRestore,
            publishedFrom,
            versionsBefore,
            versionsAfter,
            only: yield* revisionsOf(only.id),
            long: yield* revisionsOf(long.id),
          }
        }),
      ),
    )
    expect(outcome.beforeSave).toEqual(range(1, 70))
    expect(outcome.saved.draftRevision).toBe(71)
    // the head and the revision the version came from, then the newest of
    // the rest up to the count - the copy the restore made at 10 is not
    // what was published, and goes with the other old ones
    expect(outcome.afterSave).toEqual([2, ...range(71 - KEPT_DRAFT_REVISIONS, 71)])
    expect(outcome.restored.draftRevision).toBe(72)
    expect(outcome.afterRestore).toEqual([2, ...range(72 - KEPT_DRAFT_REVISIONS, 72)])
    expect(outcome.publishedFrom.sourceTs).toBe(IDENTITY)
    expect(outcome.publishedFrom.tests).toEqual(THREE)
    // the publication itself is exactly as it was
    expect(outcome.versionsAfter).toEqual(outcome.versionsBefore)
    expect(outcome.versionsAfter).toHaveLength(1)
    // and nothing was taken from the author's other formulas
    expect(outcome.only).toEqual([1])
    expect(outcome.long).toEqual(range(1, 80))
  }, 180_000)

  it('weighs the history in bytes as well as in revisions', async () => {
    const heavy = 250_000
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('fr-bytes')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(f.t, { name: '源码很长' }, as)
          yield* earlierSaves({
            t: f.t,
            functionId: created.id,
            savedBy: f.admin,
            from: 2,
            to: 31,
            bytes: heavy,
          })
          const saved = yield* library.updateDraft(
            f.t,
            created.id,
            { expectedDraftRevision: 31, draftSourceTs: '// 32' },
            as,
          )
          const draft = yield* library.getFunction(f.t, created.id, as)
          return { saved, draft, kept: yield* revisionsOf(created.id) }
        }),
      ),
    )
    // each earlier save weighs its source and its empty examples, `[]`
    const fits = Math.floor(KEPT_DRAFT_REVISION_BYTES / (heavy + 2))
    // the bytes are what bite here, not the count
    expect(fits).toBeLessThan(KEPT_DRAFT_REVISIONS)
    expect(outcome.saved.draftRevision).toBe(32)
    expect(outcome.kept).toEqual(range(32 - fits, 32))
    expect(outcome.draft.function.draftSourceTs).toBe('// 32')
  }, 120_000)
})
