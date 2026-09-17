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

// A formula's life as one model: one draft that is edited, a revision left
// behind by every save that changed what could be published, and a named
// publication frozen for good. History only grows - restoring an earlier
// state appends a revision naming where it came from.

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
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2 }),
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
            { expectedDraftRevision: 2, name: '认定分值（校级）' },
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

  it('publishes under a name that is its own, for good', async () => {
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
          // the same source under another name is a second publication
          const renamed = yield* library.publish(
            f.t,
            created.id,
            { expectedDraftRevision: 2, releaseName: '2026 春季正式规则（复核）' },
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
              { expectedDraftRevision: 3, releaseName: '2026 春季正式规则' },
              as,
            ),
          )
          const detail = yield* library.getFunction(f.t, created.id, as)
          const listed = yield* library.listFunctions(f.t, {}, as)
          const frozen = yield* library.getVersion(f.t, created.id, 1, as)
          return { spring, retried, renamed, taken, detail, listed, frozen }
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
    expect(outcome.renamed.versionNo).toBe(2)
    expect(outcome.taken._tag).toBe('ASSESSMENT_FORMULA_RELEASE_NAME_TAKEN')
    expect(outcome.detail.versions.map((row) => row.releaseName)).toEqual([
      '2026 春季正式规则（复核）',
      '2026 春季正式规则',
    ])
    expect(outcome.listed.items[0]!.latestReleaseName).toBe('2026 春季正式规则（复核）')
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
