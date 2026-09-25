import { inspect } from 'node:util'
import { Effect, Exit, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { Sandbox, type SandboxInvocation } from '@qualy/plugin-sandbox/service'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import type { Principal } from '@qualy/rbac-contract'
import type { Rbac } from '@qualy/rbac-contract/effect'
import { FormulaLibrary, layer as formulaLayer } from '../src/server/index.ts'
import { FormulaRuntimeStore, runtimeStoreLayer } from '../src/server/runtime-store.ts'
import { FORMULA_SCORING_LIMITS } from '../src/scoring/limits.ts'
import { REFERENCE_INPUT } from '../src/scoring/reference.ts'
import { seedFormulaFixture, servicesFor } from './support/stack.ts'

// The runtime sandbox is one worker in production, shared by everything that
// scores and everything authors try. Scoring must not wait behind a queue of
// authoring runs, and no one author may keep the rest queued.

/** how many authoring runs are inside the sandbox at once, at most */
interface Probe {
  live: number
  peak: number
  /** example runs asked under the scoring budget, and which of them answer out of time */
  scored: number
  /** runs of the host's reference formula asked under the scoring budget */
  referenced: number
  starve: 'nothing' | 'examples' | 'everything'
}

const fresh = (): Probe => ({ live: 0, peak: 0, scored: 0, referenced: 0, starve: 'nothing' })

// Authoring runs carry the publication-sized deadline; scoring never does.
// Each authoring run is held a moment before it goes in, so that any two
// the library lets through together are certain to overlap here.
const counted = (probe: Probe) =>
  Layer.effect(
    Sandbox,
    Effect.gen(function* () {
      const inner = yield* Sandbox
      return Sandbox.of({
        invoke: (call: SandboxInvocation) =>
          call.limits?.softDeadlineMs === FORMULA_SCORING_LIMITS.softDeadlineMs
            ? Effect.suspend(() => {
                const reference = call.arguments[0] === JSON.stringify(REFERENCE_INPUT)
                const example = call.entrypoint === '__qualyInvoke' && !reference
                if (example) probe.scored += 1
                if (reference) probe.referenced += 1
                const starved =
                  probe.starve === 'everything' || (probe.starve === 'examples' && example)
                return starved
                  ? Effect.fail({ _tag: 'SandboxTimeout', phase: 'soft' } as never)
                  : inner.invoke(call)
              })
            : call.limits?.softDeadlineMs !== 2_000
              ? inner.invoke(call)
              : Effect.acquireUseRelease(
                  Effect.sync(() => {
                    probe.live += 1
                    probe.peak = Math.max(probe.peak, probe.live)
                  }),
                  () => Effect.sleep(150).pipe(Effect.andThen(inner.invoke(call))),
                  () =>
                    Effect.sync(() => {
                      probe.live -= 1
                    }),
                ),
      })
    }),
  ).pipe(Layer.provide(sandboxLocalLayer({ size: 1, variant: 'release' })))

const stack = (url: string, probe: Probe) =>
  Layer.mergeAll(
    formulaLayer.pipe(Layer.provide(formulaAuthoringLocalLayer)),
    runtimeStoreLayer,
  ).pipe(Layer.provideMerge(Layer.merge(counted(probe), servicesFor(url))))

const run = <A, E>(
  url: string,
  probe: Probe,
  effect: Effect.Effect<A, E, FormulaLibrary | FormulaRuntimeStore | Sandbox | Rbac | Orm>,
) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url, probe) as never) as Effect.Effect<A, E>)

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const MOODY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    mode: Schema.choice({ ok: '正常', loop: '循环' }, { title: '模式' }),
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2, title: '分值' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run(input) {
    if (input.mode === 'loop') {
      for (;;) {
        // burns the deadline on purpose
      }
    }
    return input.value
  },
})
`

/** the same few hundred milliseconds spent as the module loads, with a run that costs nothing */
const SLOW_TO_LOAD = MOODY.replace(
  'export default defineFormula({',
  `let spent = 0
for (let step = 0; step < 8_000_000; step += 1) spent = (spent + step) % 7

export default defineFormula({`,
).replace('return input.value', 'return spent >= 0 ? input.value : input.value')

/** a few hundred milliseconds of arithmetic: nothing to a try-run, far past a score's budget */
const SLOW = MOODY.replace(
  'return input.value',
  `let spent = 0
    for (let step = 0; step < 8_000_000; step += 1) spent = (spent + step) % 7
    return spent >= 0 ? input.value : input.value`,
)

const LOOP = { mode: 'loop', value: '1.00' }
const FINE = { mode: 'ok', value: '1.00' }

/** one published looping formula of this person's own */
const publishedBy = (tenantId: string, as: Principal, name: string) =>
  Effect.gen(function* () {
    const library = yield* FormulaLibrary
    const created = yield* library.createFunction(tenantId, { name }, as)
    yield* library.updateDraft(
      tenantId,
      created.id,
      {
        expectedDraftRevision: 1,
        draftSourceTs: MOODY,
        draftTests: [{ name: 'fine', input: FINE, expected: '1' }],
      },
      as,
    )
    const version = yield* library.publish(
      tenantId,
      created.id,
      { expectedDraftRevision: 2, releaseName: name },
      as,
    )
    return { functionId: created.id, versionId: version.versionId }
  })

describe.runIf(postgresAvailable)('the runtime sandbox, shared by scoring and authoring', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-formula-sandbox-share')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('lets one authoring run in at a time, so a score waits behind one at most', async () => {
    const probe = fresh()
    const outcome = ok(
      await run(
        db.url,
        probe,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('ss-lane')
          const library = yield* FormulaLibrary
          const store = yield* FormulaRuntimeStore
          const sandbox = yield* Sandbox
          const people = [f.admin, f.authorA, f.authorB].map((id) => f.principal(id))
          const published: { functionId: string; versionId: string }[] = []
          for (const [index, as] of people.entries())
            published.push(yield* publishedBy(f.t, as, `循环 ${String(index)}`))
          probe.peak = 0
          const frozen = yield* store.resolve({ tenantId: f.t, versionId: published[0]!.versionId })
          // three people each trying a looping case at the same moment
          const tries = Effect.forEach(
            people,
            (as, index) =>
              library.evaluateVersion(f.t, published[index]!.functionId, 1, [{ input: LOOP }], as),
            { concurrency: 'unbounded' },
          )
          // and somebody's score asked for while they run
          const score = Effect.gen(function* () {
            yield* Effect.sleep(400)
            const started = Date.now()
            yield* sandbox.invoke({
              artifact: frozen.runtimeJs,
              artifactHash: frozen.runtimeSha256,
              entrypoint: '__qualyInvoke',
              arguments: [JSON.stringify(FINE)],
              limits: FORMULA_SCORING_LIMITS,
            })
            return Date.now() - started
          })
          const [results, waited] = yield* Effect.all([tries, score], { concurrency: 'unbounded' })
          return { results, waited }
        }),
      ),
    )
    expect(probe.peak).toBe(1)
    for (const evaluation of outcome.results)
      expect(evaluation.results[0]!.defect).toBe('execution interrupted')
    // behind the one run already in the sandbox, not behind all three
    expect(outcome.waited).toBeLessThan(4_000)
  }, 120_000)

  it('refuses a third run from one person while two are under way', async () => {
    const probe = fresh()
    const outcome = ok(
      await run(
        db.url,
        probe,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('ss-admission')
          const library = yield* FormulaLibrary
          const as = f.principal(f.authorA)
          const mine = yield* publishedBy(f.t, as, '循环')
          const theirs = yield* publishedBy(f.t, f.principal(f.authorB), '循环')
          const tries = yield* Effect.forEach(
            [0, 1, 2],
            () =>
              Effect.result(
                library.evaluateVersion(f.t, mine.functionId, 1, [{ input: LOOP }], as),
              ),
            { concurrency: 'unbounded' },
          )
          // somebody else is not held to this person's share
          const other = yield* library.evaluateVersion(
            f.t,
            theirs.functionId,
            1,
            [{ input: FINE }],
            f.principal(f.authorB),
          )
          return { tries, other }
        }),
      ),
    )
    const refused = outcome.tries.filter((one) => one._tag === 'Failure')
    expect(refused).toHaveLength(1)
    expect(refused[0]!.failure).toMatchObject({ _tag: 'ASSESSMENT_FORMULA_AUTHORING_BUSY' })
    expect(outcome.other.results[0]!.actual).toBe('1')
  }, 120_000)

  it('leaves the rest of a round unrun once one case is interrupted', async () => {
    const probe = fresh()
    const outcome = ok(
      await run(
        db.url,
        probe,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('ss-cutoff')
          const library = yield* FormulaLibrary
          const as = f.principal(f.authorA)
          const mine = yield* publishedBy(f.t, as, '循环')
          const started = Date.now()
          const evaluated = yield* library.evaluateVersion(
            f.t,
            mine.functionId,
            1,
            [{ input: FINE }, { input: LOOP }, { input: FINE }, { input: LOOP }],
            as,
          )
          return { evaluated, took: Date.now() - started }
        }),
      ),
    )
    expect(outcome.evaluated.results.map((row) => row.actual ?? row.defect)).toEqual([
      '1',
      'execution interrupted',
      'not-run',
      'not-run',
    ])
    // one deadline spent, not two
    expect(outcome.took).toBeLessThan(4_000)
  }, 120_000)

  it('publishes only what its own examples can be scored within, asked as a score asks', async () => {
    const attempt = (starve: Probe['starve'], slug: string) => {
      const probe = fresh()
      return run(
        db.url,
        probe,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture(slug)
          const library = yield* FormulaLibrary
          const as = f.principal(f.authorA)
          const created = yield* library.createFunction(f.t, { name: '计分时限' }, as)
          yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: 1,
              draftSourceTs: MOODY,
              draftTests: [{ name: 'fine', input: FINE, expected: '1' }],
            },
            as,
          )
          probe.starve = starve
          const published = yield* Effect.result(
            library.publish(f.t, created.id, { expectedDraftRevision: 2, releaseName: '慢' }, as),
          )
          const after = yield* library.getFunction(f.t, created.id, as)
          return {
            published,
            versions: after.versions.length,
            scored: probe.scored,
            referenced: probe.referenced,
          }
        }),
      ).then(ok)
    }
    // the reference formula runs within the budget and the example never
    // finishes in it: the time is the example's own
    const slow = await attempt('examples', 'ss-budget-slow')
    expect(slow.published._tag).toBe('Failure')
    expect(slow.published._tag === 'Failure' ? slow.published.failure : null).toMatchObject({
      _tag: 'ASSESSMENT_FORMULA_TEST_FAILED',
      report: [{ name: 'fine', passed: false, defect: 'over-scoring-budget' }],
    })
    // asked the way a score asks - once more past a soft deadline - in each
    // of the rounds the host was fit to judge
    expect(slow.scored).toBe(6)
    expect(slow.referenced).toBe(3)
    expect(slow.versions).toBe(0)
    // nothing fits the budget at all, the reference included: that is the
    // host, and the question is left to be asked again rather than waved on
    const busy = await attempt('everything', 'ss-budget-busy')
    expect(busy.published._tag).toBe('Failure')
    expect(busy.published._tag === 'Failure' ? busy.published.failure : null).toMatchObject({
      _tag: 'ASSESSMENT_FORMULA_COMPILE_UNAVAILABLE',
    })
    expect(busy.versions).toBe(0)
  }, 120_000)

  it('refuses to publish a formula too slow to score, however well it tries', async () => {
    const probe = fresh()
    const outcome = ok(
      await run(
        db.url,
        probe,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('ss-slow')
          const library = yield* FormulaLibrary
          const as = f.principal(f.authorA)
          const created = yield* library.createFunction(f.t, { name: '慢公式' }, as)
          yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: 1,
              draftSourceTs: SLOW,
              draftTests: [{ name: 'fine', input: FINE, expected: '1' }],
            },
            as,
          )
          const tried = yield* library.evaluateDraft(f.t, created.id, SLOW, [{ input: FINE }], as)
          const refused = yield* Effect.flip(
            library.publish(f.t, created.id, { expectedDraftRevision: 2, releaseName: '慢' }, as),
          )
          return { tried, refused }
        }),
      ),
    )
    // well within the try-run's deadline
    expect(outcome.tried.results[0]!.actual).toBe('1')
    expect(outcome.refused).toMatchObject({
      _tag: 'ASSESSMENT_FORMULA_TEST_FAILED',
      report: [{ name: 'fine', passed: false, defect: 'over-scoring-budget' }],
    })
  }, 120_000)

  // Loading the artifact is part of every score: a module that spends the
  // budget as it loads makes its own contract as slow as its examples, which
  // once read as a busy host and let the version through.
  it('refuses to publish a formula whose module is too slow to load for a score', async () => {
    const probe = fresh()
    const outcome = ok(
      await run(
        db.url,
        probe,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('ss-slow-load')
          const library = yield* FormulaLibrary
          const as = f.principal(f.authorA)
          const created = yield* library.createFunction(f.t, { name: '加载慢' }, as)
          yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: 1,
              draftSourceTs: SLOW_TO_LOAD,
              draftTests: [{ name: 'fine', input: FINE, expected: '1' }],
            },
            as,
          )
          const tried = yield* library.evaluateDraft(
            f.t,
            created.id,
            SLOW_TO_LOAD,
            [{ input: FINE }],
            as,
          )
          const refused = yield* Effect.flip(
            library.publish(f.t, created.id, { expectedDraftRevision: 2, releaseName: '慢' }, as),
          )
          const after = yield* library.getFunction(f.t, created.id, as)
          return { tried, refused, versions: after.versions.length }
        }),
      ),
    )
    expect(outcome.tried.results[0]!.actual).toBe('1')
    expect(outcome.refused).toMatchObject({
      _tag: 'ASSESSMENT_FORMULA_TEST_FAILED',
      report: [{ name: 'fine', passed: false, defect: 'over-scoring-budget' }],
    })
    expect(outcome.versions).toBe(0)
  }, 120_000)
})
