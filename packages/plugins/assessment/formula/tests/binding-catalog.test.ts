import { inspect } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Effect, Exit, Fiber, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { transaction, type Orm } from '@qualy/plugin-database/server'
import {
  BindableFormulaCatalog,
  bindingCatalogLayer,
  type BindablePage,
  type FormulaNotBindable,
} from '../src/server/binding-catalog.ts'
import { FormulaRuntimeStore, runtimeStoreLayer } from '../src/server/runtime-store.ts'
import { one, seedFormulaFixture, servicesFor } from './support/stack.ts'
import { addVersion, ARTIFACT, publishedVersion, sha256Hex } from './support/versions.ts'

// What a question may be scored by, as a read model of FACTS - no principal
// in any signature. Who may create a binding is an authoring question with
// an actor, answered beside the compiler; this service is asked only what
// exists and what state it is in, and the author id it takes is a column to
// filter on rather than an identity to authorize.
//
// One thing it must keep apart. A version's function may be archived, and
// then it is no longer offered for new configuration - while the runtime
// store goes on resolving it, because a question already bound to it must
// keep running. The two services parting ways on one fixture is the
// continuation/new-binding split made flesh.

const stack = (url: string) =>
  Layer.mergeAll(runtimeStoreLayer, bindingCatalogLayer).pipe(Layer.provideMerge(servicesFor(url)))

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

describe.runIf(postgresAvailable)('the bindable formula catalog', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('formula-binding-catalog')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('offers one author their own published versions, and nobody else theirs', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('bind-cat')
          const catalog = yield* BindableFormulaCatalog
          const store = yield* FormulaRuntimeStore

          const mine = yield* publishedVersion(f.t, f.authorA, 'A 的公式')
          const theirs = yield* publishedVersion(f.t, f.authorB, 'B 的公式')

          const forA = yield* catalog.listForBatch(f.t, f.authorA)
          const forB = yield* catalog.listForBatch(f.t, f.authorB)

          // archive A's function: replay keeps answering, new binding stops
          // - the same row, two different rights
          yield* runSql(sql`
            update assessment_formula_functions set archived_at = now()
            where id = ${mine.functionId}`)
          const afterArchive = yield* catalog.listForBatch(f.t, f.authorA)
          const archivedResolve = yield* store.resolve({
            tenantId: f.t,
            versionId: mine.versionId,
          })
          const archivedBind = yield* Effect.exit(catalog.requireBindable(f.t, mine.versionId))
          const unknownVersion = yield* Effect.exit(catalog.requireBindable(f.t, randomUUID()))

          return {
            forA: forA.items.map((row) => row.versionId),
            forB: forB.items.map((row) => row.versionId),
            afterArchive: afterArchive.items.map((row) => row.versionId),
            archivedResolve: archivedResolve.runtimeSha256,
            archivedBind: reasonOf(archivedBind),
            unknownVersion: reasonOf(unknownVersion),
            mine: mine.versionId,
            theirs: theirs.versionId,
          }
        }),
      ),
    )

    // each author is offered what they wrote, and only that
    expect(outcome.forA).toEqual([outcome.mine])
    expect(outcome.forB).toEqual([outcome.theirs])
    // archived: gone from the offer, still resolvable for whoever runs it
    expect(outcome.afterArchive).toEqual([])
    expect(outcome.archivedResolve).toBe(sha256Hex(ARTIFACT))
    expect(outcome.archivedBind).toBe('function-archived')
    expect(outcome.unknownVersion).toBe('version-not-found')
  })

  it('makes an archive wait for the item revision, not race it', async () => {
    // The writer's transaction reads the fact its yes depends on under FOR
    // SHARE. A concurrent archive (an UPDATE on the function row) must queue
    // behind the commit - the requireBindable connection is the services'
    // pool, the contender is the admin pool, genuinely two sessions.
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('bc-locks')
          const catalog = yield* BindableFormulaCatalog
          const published = yield* publishedVersion(f.t, f.authorA, '锁下公式')

          const contender = yield* Effect.forkChild(
            Effect.promise(async () => {
              const started = Date.now()
              await db.query(
                `update assessment_formula_functions set archived_at = now() where id = $1`,
                [published.functionId],
              )
              return Date.now() - started
            }),
          )

          // the save's own transaction: prove the binding, hold, commit
          const inside = yield* transaction(
            Effect.gen(function* () {
              const proven = yield* catalog.requireBindable(f.t, published.versionId)
              // long enough that an unlocked contender would certainly have
              // landed before the commit
              yield* Effect.promise(() => new Promise((done) => setTimeout(done, 300)))
              return proven.versionId
            }),
          )
          const waitedMs = yield* Fiber.join(contender)

          const after = yield* Effect.exit(catalog.requireBindable(f.t, published.versionId))
          return { inside, waitedMs, after: reasonOf(after) }
        }),
      ),
    )

    expect(outcome.inside).toEqual(expect.any(String))
    // the archive could not land while the proof was held
    expect(outcome.waitedMs).toBeGreaterThan(150)
    // and once it did, the same version is no longer offered anew
    expect(outcome.after).toBe('function-archived')
  })

  it('walks every version once across pages, however the names collide', async () => {
    // The ordering runs in two directions - names up, versions down - and
    // two functions may share a name, so the page boundary is only sound
    // with the version id closing it. Two same-named functions carrying the
    // same version numbers is exactly the shape that drops or repeats rows
    // when it is not.
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('bc-paging')
          const catalog = yield* BindableFormulaCatalog
          const publishVersions = (name: string, count: number) =>
            Effect.gen(function* () {
              const first = yield* publishedVersion(f.t, f.authorA, name, 1)
              const ids = [first.versionId]
              for (let no = 2; no <= count; no += 1) {
                ids.push(yield* addVersion(f.t, first.functionId, f.authorA, no))
              }
              return ids
            })
          // the same name twice, three versions each
          const left = yield* publishVersions('同名公式', 3)
          const right = yield* publishVersions('同名公式', 3)

          // one at a time: the two functions share a name AND their version
          // numbers, so every page boundary falls between two rows that
          // differ only by id - which is the whole point of the last key
          const walked: string[] = []
          let after: { functionName: string; versionNo: number; versionId: string } | undefined =
            undefined
          for (let page = 0; page < 20; page += 1) {
            const got: BindablePage = yield* catalog.listForBatch(f.t, f.authorA, {
              limit: 1,
              after,
            })
            walked.push(...got.items.map((row) => row.versionId))
            if (!got.more || got.last === null) break
            after = got.last
          }
          const all = yield* catalog.listForBatch(f.t, f.authorA, { limit: 100 })
          return {
            walked,
            every: all.items.map((row) => row.versionId),
            planted: [...left, ...right],
          }
        }),
      ),
    )
    // every planted version, exactly once, and the same set the single page
    // returns - no drops at the boundary, no repeats
    expect([...outcome.walked].sort()).toEqual([...outcome.planted].sort())
    expect([...outcome.every].sort()).toEqual([...outcome.planted].sort())
  })

  it('shows a bound version as history, whatever became of its function', async () => {
    // A question already bound keeps showing what it runs. The offer and the
    // history are separate reads for exactly this reason: an archived
    // function leaves the list, and the question that runs one of its
    // versions still names it - with `bindableForNew` saying, for THIS
    // viewer, whether the same choice could be made afresh today.
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('bc-current')
          const catalog = yield* BindableFormulaCatalog
          const published = yield* publishedVersion(f.t, f.authorA, '仍在跑的公式')

          const live = yield* catalog.currentBinding(f.t, published.versionId, f.authorA)
          // somebody else looking at the same question: it is history to
          // them too, but not a choice they could make
          const asOther = yield* catalog.currentBinding(f.t, published.versionId, f.authorB)

          yield* runSql(sql`
            update assessment_formula_functions set archived_at = now()
            where id = ${published.functionId}`)
          const archived = yield* catalog.currentBinding(f.t, published.versionId, f.authorA)
          const offered = yield* catalog.listForBatch(f.t, f.authorA)
          const missing = yield* catalog.currentBinding(f.t, randomUUID(), f.authorA)

          return {
            live: { id: live?.version.versionId, bindable: live?.bindableForNew },
            asOther: { id: asOther?.version.versionId, bindable: asOther?.bindableForNew },
            archived: { id: archived?.version.versionId, bindable: archived?.bindableForNew },
            offered: offered.items.length,
            missing,
            published: published.versionId,
          }
        }),
      ),
    )

    expect(outcome.live).toEqual({ id: outcome.published, bindable: true })
    // the same row, read by somebody who did not write it
    expect(outcome.asOther).toEqual({ id: outcome.published, bindable: false })
    // archived: still shown, no longer a choice
    expect(outcome.archived).toEqual({ id: outcome.published, bindable: false })
    expect(outcome.offered).toBe(0)
    // and a version nobody has is not a history to invent
    expect(outcome.missing).toBeNull()
  })
})
