import { inspect } from 'node:util'
import { Effect, Exit, Layer, Result } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import type { Rbac } from '@qualy/rbac-contract/effect'
import { FormulaLibrary, TESTS_LIMIT, layer as formulaLayer } from '../src/server/index.ts'
import { seedFormulaFixture, servicesFor } from './support/stack.ts'

// A formula's life as one model: one draft that is edited, a revision left
// behind by every save that changed what could be published, and publications
// whose executable record is frozen for good while the name and notes on it
// stay the author's to rewrite. History never rewinds - restoring an earlier
// state appends a revision naming where it came from. How much of it a
// formula keeps is formula-retention.test.ts.

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

const DOUBLED = IDENTITY.replace(
  'run: (input) => input.value,',
  'run: (input, q) => q.decimal.add(input.value, input.value),',
)

const THREE = [{ name: 'three', input: { value: '3.00' }, expected: '3' }]

describe.runIf(postgresAvailable)('a formula over its lifetime', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-formula-history')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('starts empty, and leaves a revision only when what could be published moves', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fh-revisions')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(f.t, { name: '认定分值' }, as)
          const saved = yield* library.updateDraft(
            f.t,
            created.id,
            { expectedDraftRevision: 1, draftSourceTs: IDENTITY, draftTests: THREE },
            as,
          )
          // the same examples sent again, keys in another order: no change
          const repeated = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: 2,
              draftSourceTs: IDENTITY,
              draftTests: [{ expected: '3', input: { value: '3.00' }, name: 'three' }],
            },
            as,
          )
          const renamed = yield* library.updateDraft(
            f.t,
            created.id,
            // a rename carries the words' own token, not the draft's
            { expectedDraftRevision: 2, expectedDetailsRevision: 1, name: '认定分值（校级）' },
            as,
          )
          const revisions = yield* library.listDraftRevisions(f.t, created.id, {}, as)
          const second = yield* library.getDraftRevision(f.t, created.id, 2, as)
          const first = yield* library.getDraftRevision(f.t, created.id, 1, as)
          const trail = rows<{ action_code: string }>(
            yield* runSql(sql`
              select action_code from audit_events
               where tenant_id = ${f.t} and target_id = ${created.id}
               order by occurred_at`),
          ).map((row) => row.action_code)
          return { created, saved, repeated, renamed, revisions, first, second, trail }
        }),
      ),
    )
    // nothing written in for the author
    expect(outcome.created.draftSourceTs).toBe('')
    expect(outcome.created.draftRevision).toBe(1)
    expect(outcome.saved.draftRevision).toBe(2)
    expect(outcome.repeated.draftRevision).toBe(2)
    // a rename is not a revision
    expect(outcome.renamed.draftRevision).toBe(2)
    expect(outcome.renamed.name).toBe('认定分值（校级）')
    expect(outcome.revisions.items.map((row) => [row.revisionNo, row.origin])).toEqual([
      [2, 'saved'],
      [1, 'created'],
    ])
    expect(outcome.revisions.items[0]!.savedByName).toBe('Admin')
    expect(outcome.first.sourceTs).toBe('')
    expect(outcome.second.sourceTs).toBe(IDENTITY)
    expect(outcome.second.tests).toEqual(THREE)
    // the revision is the save's history; the trail keeps what leaves none
    expect(outcome.trail).toEqual([
      'assessment.formula.create',
      'assessment.formula.details.change',
    ])
  }, 120_000)

  it('publishes once per set of bytes, whatever the publication is called', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fh-release')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(f.t, { name: '认定分值' }, as)
          yield* library.updateDraft(
            f.t,
            created.id,
            { expectedDraftRevision: 1, draftSourceTs: IDENTITY, draftTests: THREE },
            as,
          )
          const spring = yield* library.publish(
            f.t,
            created.id,
            {
              expectedDraftRevision: 2,
              releaseName: '2026 春季正式规则',
              releaseNotes: '首次发布',
            },
            as,
          )
          // the very same request again: the publication that exists
          const retried = yield* library.publish(
            f.t,
            created.id,
            {
              expectedDraftRevision: 2,
              releaseName: '2026 春季正式规则',
              releaseNotes: '首次发布',
            },
            as,
          )
          // the same source under another name is NOT a second publication:
          // what a version executes is unchanged, and the name is a label
          // that can be rewritten on the one that exists
          const unchanged = yield* Effect.flip(
            library.publish(
              f.t,
              created.id,
              { expectedDraftRevision: 2, releaseName: '2026 春季正式规则（复核）' },
              as,
            ),
          )
          const renamed = yield* library.updateVersionInfo(
            f.t,
            created.id,
            1,
            {
              expectedMetadataRevision: 1,
              releaseName: '2026 春季正式规则（复核）',
              releaseNotes: '补充口径说明',
            },
            as,
          )
          yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: 2,
              draftSourceTs: DOUBLED,
              draftTests: [{ name: 'six', input: { value: '3.00' }, expected: '6' }],
            },
            as,
          )
          const taken = yield* Effect.flip(
            library.publish(
              f.t,
              created.id,
              { expectedDraftRevision: 3, releaseName: '2026 春季正式规则（复核）' },
              as,
            ),
          )
          yield* library.publish(
            f.t,
            created.id,
            { expectedDraftRevision: 3, releaseName: '2026 秋季正式规则' },
            as,
          )
          const detail = yield* library.getFunction(f.t, created.id, as)
          const listed = yield* library.listFunctions(f.t, {}, as)
          const frozen = yield* library.getVersion(f.t, created.id, 1, as)
          return { spring, retried, unchanged, renamed, taken, detail, listed, frozen }
        }),
      ),
    )
    expect(outcome.spring).toMatchObject({
      versionNo: 1,
      releaseName: '2026 春季正式规则',
      releaseNotes: '首次发布',
      publishedByName: 'Admin',
    })
    expect(outcome.retried.versionId).toBe(outcome.spring.versionId)
    expect(outcome.unchanged).toMatchObject({
      _tag: 'ASSESSMENT_FORMULA_VERSION_UNCHANGED',
      versionNo: 1,
    })
    // relabelling leaves the publication itself exactly where it was
    expect(outcome.renamed).toMatchObject({
      versionId: outcome.spring.versionId,
      versionNo: 1,
      releaseName: '2026 春季正式规则（复核）',
      releaseNotes: '补充口径说明',
      metadataRevision: 2,
      publishedBy: outcome.spring.publishedBy,
      publishedAt: outcome.spring.publishedAt,
    })
    expect(outcome.renamed.sourceTs).toBe(outcome.spring.sourceTs)
    expect(outcome.renamed.metadataUpdatedAt).not.toBeNull()
    expect(outcome.taken._tag).toBe('ASSESSMENT_FORMULA_RELEASE_NAME_TAKEN')
    expect(outcome.detail.versions.map((row) => row.releaseName)).toEqual([
      '2026 秋季正式规则',
      '2026 春季正式规则（复核）',
    ])
    expect(outcome.listed.items[0]!.latestReleaseName).toBe('2026 秋季正式规则')
    // the frozen record carries the world it was proven in
    expect(outcome.frozen.sourceTs).toBe(IDENTITY)
    expect(outcome.frozen.sourcePolicyParserVersion).not.toBe('')
    expect(outcome.frozen.valueSchemaProfileVersion).toBeGreaterThan(0)
  }, 180_000)

  it('restores an earlier state as a new revision, and never rewinds', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fh-restore')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(f.t, { name: '认定分值' }, as)
          yield* library.updateDraft(
            f.t,
            created.id,
            { expectedDraftRevision: 1, draftSourceTs: IDENTITY, draftTests: THREE },
            as,
          )
          yield* library.publish(
            f.t,
            created.id,
            { expectedDraftRevision: 2, releaseName: '春季规则' },
            as,
          )
          yield* library.updateDraft(
            f.t,
            created.id,
            { expectedDraftRevision: 2, draftSourceTs: DOUBLED, draftTests: [] },
            as,
          )
          const fromVersion = yield* library.restoreDraft(
            f.t,
            created.id,
            { expectedDraftRevision: 3, from: { kind: 'published-version', versionNo: 1 } },
            as,
          )
          // putting back what is already there is no change
          const again = yield* library.restoreDraft(
            f.t,
            created.id,
            { expectedDraftRevision: 4, from: { kind: 'published-version', versionNo: 1 } },
            as,
          )
          const fromDraft = yield* library.restoreDraft(
            f.t,
            created.id,
            { expectedDraftRevision: 4, from: { kind: 'draft-revision', revisionNo: 3 } },
            as,
          )
          const stale = yield* Effect.flip(
            library.restoreDraft(
              f.t,
              created.id,
              { expectedDraftRevision: 4, from: { kind: 'draft-revision', revisionNo: 1 } },
              as,
            ),
          )
          const noVersion = yield* Effect.flip(
            library.restoreDraft(
              f.t,
              created.id,
              { expectedDraftRevision: 5, from: { kind: 'published-version', versionNo: 9 } },
              as,
            ),
          )
          const noRevision = yield* Effect.flip(
            library.restoreDraft(
              f.t,
              created.id,
              { expectedDraftRevision: 5, from: { kind: 'draft-revision', revisionNo: 99 } },
              as,
            ),
          )
          const revisions = yield* library.listDraftRevisions(f.t, created.id, {}, as)
          const version = yield* library.getVersion(f.t, created.id, 1, as)
          return { fromVersion, again, fromDraft, stale, noVersion, noRevision, revisions, version }
        }),
      ),
    )
    expect(outcome.fromVersion.draftRevision).toBe(4)
    expect(outcome.fromVersion.draftSourceTs).toBe(IDENTITY)
    expect(outcome.fromVersion.draftTests).toEqual(THREE)
    expect(outcome.again.draftRevision).toBe(4)
    expect(outcome.fromDraft.draftRevision).toBe(5)
    expect(outcome.fromDraft.draftSourceTs).toBe(DOUBLED)
    expect(outcome.stale._tag).toBe('ASSESSMENT_FORMULA_DRAFT_CONFLICT')
    expect(outcome.noVersion._tag).toBe('ASSESSMENT_FORMULA_VERSION_NOT_FOUND')
    expect(outcome.noRevision._tag).toBe('ASSESSMENT_FORMULA_DRAFT_REVISION_NOT_FOUND')
    expect(
      outcome.revisions.items.map((row) => ({
        no: row.revisionNo,
        origin: row.origin,
        version: row.sourceVersion,
        draft: row.sourceDraftRevisionNo,
      })),
    ).toEqual([
      { no: 5, origin: 'restored-from-draft', version: null, draft: 3 },
      {
        no: 4,
        origin: 'restored-from-version',
        version: { versionNo: 1, releaseName: '春季规则' },
        draft: null,
      },
      { no: 3, origin: 'saved', version: null, draft: null },
      { no: 2, origin: 'saved', version: null, draft: null },
      { no: 1, origin: 'created', version: null, draft: null },
    ])
    // the publication restored from is untouched
    expect(outcome.version.sourceTs).toBe(IDENTITY)
  }, 180_000)

  it('relabels a publication without touching what it scores', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fh-relabel')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(f.t, { name: '认定分值' }, as)
          yield* library.updateDraft(
            f.t,
            created.id,
            { expectedDraftRevision: 1, draftSourceTs: IDENTITY, draftTests: THREE },
            as,
          )
          const published = yield* library.publish(
            f.t,
            created.id,
            { expectedDraftRevision: 2, releaseName: '春季规侧' },
            as,
          )
          const fixed = yield* library.updateVersionInfo(
            f.t,
            created.id,
            1,
            {
              expectedMetadataRevision: 1,
              releaseName: '2026 春季规则',
              releaseNotes: '校级每小时 0.1 分，院级每小时 0.06 分',
            },
            as,
          )
          // a second window holding the label as it was read before
          const stale = yield* Effect.flip(
            library.updateVersionInfo(
              f.t,
              created.id,
              1,
              { expectedMetadataRevision: 1, releaseName: '另一个名字', releaseNotes: null },
              as,
            ),
          )
          // the same words again are not an act: no revision, no trail row
          const again = yield* library.updateVersionInfo(
            f.t,
            created.id,
            1,
            {
              expectedMetadataRevision: 2,
              releaseName: '2026 春季规则',
              releaseNotes: '校级每小时 0.1 分，院级每小时 0.06 分',
            },
            as,
          )
          const detail = yield* library.getFunction(f.t, created.id, as)
          const trail = yield* library.getVersion(f.t, created.id, 1, as)
          return { published, fixed, stale, again, detail, trail }
        }),
      ),
    )
    expect(outcome.fixed).toMatchObject({
      versionNo: 1,
      releaseName: '2026 春季规则',
      metadataRevision: 2,
      publishedAt: outcome.published.publishedAt,
      publishedBy: outcome.published.publishedBy,
    })
    // the executable record is byte for byte what was proven
    expect(outcome.fixed.sourceTs).toBe(outcome.published.sourceTs)
    expect(outcome.fixed.sourceSha256).toBe(outcome.published.sourceSha256)
    expect(outcome.fixed.runtimeSha256).toBe(outcome.published.runtimeSha256)
    expect(outcome.fixed.tests).toEqual(outcome.published.tests)
    expect(outcome.stale).toMatchObject({
      _tag: 'ASSESSMENT_FORMULA_VERSION_INFO_CONFLICT',
      metadataRevision: 2,
    })
    expect(outcome.again.metadataRevision).toBe(2)
    // one publication, still: relabelling never mints a version
    expect(outcome.detail.versions).toHaveLength(1)
    // the list hands back the revision it read, so relabelling twice from it
    // does not read as somebody else's change
    expect(outcome.detail.versions[0]).toMatchObject({
      releaseName: '2026 春季规则',
      metadataRevision: 2,
    })
    expect(outcome.trail.releaseName).toBe('2026 春季规则')
    expect(outcome.trail.metadataUpdatedByName).toBe('Admin')
  }, 180_000)

  it('refuses a rename made against words somebody else already changed', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fh-details')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { name: '认定分值', description: '原说明' },
            as,
          )
          // two windows, both holding what the formula said when they opened
          const held = { draft: created.draftRevision, details: created.detailsRevision }
          const renamed = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: held.draft,
              expectedDetailsRevision: held.details,
              name: '认定分值（修订）',
            },
            as,
          )
          // the second window now writes the description against the token it
          // read, which the rename has moved
          const stale = yield* Effect.flip(
            library.updateDraft(
              f.t,
              created.id,
              {
                expectedDraftRevision: held.draft,
                expectedDetailsRevision: held.details,
                description: '新说明',
              },
              as,
            ),
          )
          // and succeeds once it carries the one that is current
          const after = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: held.draft,
              expectedDetailsRevision: renamed.detailsRevision,
              description: '新说明',
            },
            as,
          )
          // saving the SOURCE is untouched by any of it: it has its own token
          const saved = yield* library.updateDraft(
            f.t,
            created.id,
            { expectedDraftRevision: held.draft, draftSourceTs: IDENTITY },
            as,
          )
          return { created, renamed, stale, after, saved }
        }),
      ),
    )
    expect(outcome.created.detailsRevision).toBe(1)
    expect(outcome.renamed).toMatchObject({ name: '认定分值（修订）', detailsRevision: 2 })
    // the rename did not move the draft: nothing that could be published changed
    expect(outcome.renamed.draftRevision).toBe(outcome.created.draftRevision)
    expect(outcome.stale).toMatchObject({
      _tag: 'ASSESSMENT_FORMULA_DETAILS_CONFLICT',
      detailsRevision: 2,
    })
    // the words both windows wrote are both there, because neither was dropped
    expect(outcome.after).toMatchObject({
      name: '认定分值（修订）',
      description: '新说明',
      detailsRevision: 3,
    })
    // and the source save moved the draft revision and nothing else
    expect(outcome.saved.draftRevision).toBe(outcome.created.draftRevision + 1)
    expect(outcome.saved.detailsRevision).toBe(3)
  }, 180_000)

  it('holds the examples to a ceiling wherever a snapshot of them would be kept', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fh-tests-ceiling')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(f.t, { name: '示例上限' }, as)
          const heavy = [{ name: 'heavy', input: { note: 'x'.repeat(TESTS_LIMIT) }, expected: '1' }]
          const count = () =>
            runSql(sql`
              select count(*)::int as n from assessment_formula_draft_revisions
               where function_id = ${created.id}`).pipe(
              Effect.map((result) => rows<{ n: number }>(result)[0]!.n),
            )
          // sent as the examples of a save
          const sent = yield* Effect.flip(
            library.updateDraft(
              f.t,
              created.id,
              { expectedDraftRevision: 1, draftSourceTs: IDENTITY, draftTests: heavy },
              as,
            ),
          )
          const afterSent = yield* count()
          // already on a draft written before the ceiling: a source-only save
          // would copy them into one more snapshot
          yield* runSql(sql`
            update assessment_formula_functions set draft_tests = ${JSON.stringify(heavy)}::jsonb
             where id = ${created.id}`)
          const carried = yield* Effect.flip(
            library.updateDraft(
              f.t,
              created.id,
              { expectedDraftRevision: 1, draftSourceTs: IDENTITY },
              as,
            ),
          )
          const afterCarried = yield* count()
          // and in an earlier state a restore would put back
          yield* runSql(sql`
            update assessment_formula_functions set draft_tests = '[]'::jsonb
             where id = ${created.id}`)
          yield* runSql(sql`
            update assessment_formula_draft_revisions set tests = ${JSON.stringify(heavy)}::jsonb
             where function_id = ${created.id} and revision_no = 1`)
          yield* library.updateDraft(
            f.t,
            created.id,
            { expectedDraftRevision: 1, draftSourceTs: IDENTITY },
            as,
          )
          const restored = yield* Effect.flip(
            library.restoreDraft(
              f.t,
              created.id,
              { expectedDraftRevision: 2, from: { kind: 'draft-revision', revisionNo: 1 } },
              as,
            ),
          )
          const afterRestore = yield* count()
          return { sent, afterSent, carried, afterCarried, restored, afterRestore }
        }),
      ),
    )
    for (const refusal of [outcome.sent, outcome.carried, outcome.restored]) {
      expect(refusal).toMatchObject({
        _tag: 'ASSESSMENT_FORMULA_TESTS_TOO_LARGE',
        limit: TESTS_LIMIT,
      })
    }
    // nothing kept for any of them: the one revision after the first is
    // the source-only save that went through once the draft was trimmed
    expect(outcome.afterSent).toBe(1)
    expect(outcome.afterCarried).toBe(1)
    expect(outcome.afterRestore).toBe(2)
  }, 120_000)

  it("draws every draft write from the author's allowance, and keeps nothing it refuses", async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fh-allowance')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(f.t, { name: '频率' }, as)
          let revision = 1
          let accepted = 0
          const refused: string[] = []
          for (let n = 0; n < 45; n += 1) {
            const saved = yield* Effect.result(
              library.updateDraft(
                f.t,
                created.id,
                { expectedDraftRevision: revision, draftSourceTs: `// ${String(n)}\n` },
                as,
              ),
            )
            if (Result.isSuccess(saved)) {
              revision = saved.success.draftRevision
              accepted += 1
            } else refused.push(saved.failure._tag)
          }
          // a restore is a write of its own, however small the request
          const restore = yield* Effect.flip(
            library.restoreDraft(
              f.t,
              created.id,
              { expectedDraftRevision: revision, from: { kind: 'draft-revision', revisionNo: 1 } },
              as,
            ),
          )
          const kept = rows<{ n: number }>(
            yield* runSql(sql`
              select count(*)::int as n from assessment_formula_draft_revisions
               where function_id = ${created.id}`),
          )[0]!.n
          // the allowance is one person's: somebody else still writes
          const other = yield* library.createFunction(f.t, { name: '别人' }, f.principal(f.authorA))
          return { accepted, refused, restore, kept, revision, other }
        }),
      ),
    )
    // the creation took one: the burst is spent within the loop
    expect(outcome.accepted).toBeGreaterThanOrEqual(39)
    expect(outcome.refused.length).toBeGreaterThan(0)
    expect(new Set(outcome.refused)).toEqual(new Set(['ASSESSMENT_FORMULA_AUTHORING_BUSY']))
    expect(outcome.restore).toMatchObject({ _tag: 'ASSESSMENT_FORMULA_AUTHORING_BUSY' })
    expect(outcome.kept).toBe(1 + outcome.accepted)
    expect(outcome.revision).toBe(1 + outcome.accepted)
    expect(outcome.other.draftRevision).toBe(1)
  }, 120_000)

  it('pages the revisions newest first without repeats or gaps', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fh-paging')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(f.t, { name: '分页' }, as)
          let revision = 1
          for (const n of [1, 2, 3, 4]) {
            const saved = yield* library.updateDraft(
              f.t,
              created.id,
              { expectedDraftRevision: revision, draftSourceTs: `// ${String(n)}\n` },
              as,
            )
            revision = saved.draftRevision
          }
          const first = yield* library.listDraftRevisions(f.t, created.id, { limit: '2' }, as)
          const second = yield* library.listDraftRevisions(
            f.t,
            created.id,
            { limit: '2', cursor: first.nextCursor! },
            as,
          )
          const third = yield* library.listDraftRevisions(
            f.t,
            created.id,
            { limit: '2', cursor: second.nextCursor! },
            as,
          )
          return { first, second, third }
        }),
      ),
    )
    expect(
      [...outcome.first.items, ...outcome.second.items, ...outcome.third.items].map(
        (row) => row.revisionNo,
      ),
    ).toEqual([5, 4, 3, 2, 1])
    expect(outcome.third.nextCursor).toBeNull()
  }, 120_000)
})

const seed = seedFormulaFixture
