import { Effect } from 'effect'
import { sql, type KyselyPlugin, type QueryResult, type UnknownRow } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { entityManager } from '@qualy/plugin-database/server'
import { liveEntryPayloads } from '../src/item/db.ts'
import { Assessment } from '../src/server/index.ts'
import { errorOf, ok, one, run, runningBatch, seed, type Seeded } from './support/round.ts'

// What a configuration change costs the rest of the batch.
//
// Editing a running question takes the batch row lock and holds it for the
// whole change: reading what the change would disturb, then moving every
// open round onto the new policy. Filing a claim and recording a decision
// queue behind that lock, so what the edit reads and how many times it asks
// the same question is the length of the stop.

/** the review-role stage of the fixture, by the name the policy gives it */
const stage = (f: Seeded, id: string, label?: string) => ({
  id,
  ...(label === undefined ? {} : { label }),
  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
  quorum: { type: 'any' },
})

const configWith = (f: Seeded, stages: readonly unknown[]) => ({
  entrySource: 'student' as const,
  formConfig: { files: {} },
  scoringConfig: {
    calculator: { ref: 'fixed@1', config: { value: '3.00' } },
    aggregator: { ref: 'sum@1', config: {} },
  },
  reviewPolicy: { normal: { stages: [...stages] }, escalation: { stages: [] } },
})

/**
 * Every statement the services send, as the text they sent.
 *
 * A kysely plugin sees each query on its way out, which is where a statement
 * count can be taken without the services knowing they are being counted.
 * Installed on the connection's own client so the transactions started from
 * it inherit it.
 */
const watchStatements = Effect.gen(function* () {
  const em = yield* entityManager<[]>()
  const seen: string[] = []
  const plugin: KyselyPlugin = {
    transformQuery: (args) => {
      const node = args.node as { kind: string; sqlFragments?: readonly string[] }
      if (node.kind === 'RawNode') seen.push((node.sqlFragments ?? []).join(' ? '))
      return args.node
    },
    transformResult: (args) => Promise.resolve(args.result as QueryResult<UnknownRow>),
  }
  const connection = em.getConnection()
  const watched = connection.getClient().withPlugin(plugin)
  connection.getClient = () => watched
  return seen
})

/** the authorization query that enumerates a step's judges, however it is asked */
const reviewerProbes = (seen: readonly string[]) =>
  seen.filter((text) => text.includes('from role_grants rg0')).length

const submitted = (f: Seeded, itemId: string, participantId: string, who: string) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const as = f.principal(who)
    const entry = yield* assessment.createEntry(f.t, { itemId, participantId, payload: {} }, as)
    yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', as)
    return entry.id
  })

describe.runIf(postgresAvailable)('the cost of editing a running question', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-item-change-cost')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('carries one copy of the form the answers were written under', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('cost-scan')
          const g = yield* runningBatch(f, { stages: [stage(f, 'n1')] })
          yield* submitted(f, g.item.id, g.p1, f.s1)
          yield* submitted(f, g.item.id, g.p2, f.s2)
          const live = yield* liveEntryPayloads(f.t, g.item.id)
          return {
            entries: live.length,
            revisions: new Set(live.map((row) => row.itemRevisionId)).size,
            shared: live.every((row) => row.formConfig === live[0]!.formConfig),
            form: live[0]!.formConfig,
          }
        }),
      ),
    )

    expect(result.entries).toBe(2)
    // two answers written under one form
    expect(result.revisions).toBe(1)
    expect(result.form).toEqual({ files: {} })
    // and the scan holds that form once, not once per answer: the read is
    // what a question with a full roster behind it pays on every save
    expect(result.shared).toBe(true)
  })

  it('asks who staffs a step once, however many rounds land on it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('cost-reroute')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { stages: [stage(f, 'n1')] })
          // two students of the same class: their rounds resolve to the same
          // step, at the same unit, held by the same role
          yield* submitted(f, g.item.id, g.p1, f.s1)
          yield* submitted(f, g.item.id, g.p2, f.s2)

          // the administrator names the step, which is an edit to the policy
          const renamed = configWith(f, [stage(f, 'n1', '班级初审')])
          const asked = yield* Effect.exit(
            assessment.updateItem(f.t, g.item.id, { config: renamed }, admin),
          )
          const report = errorOf<{ impactToken: string; review: { open: number } }>(asked)!

          const seen = yield* watchStatements
          yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: renamed,
              reason: '给环节起个名字',
              effects: {
                impactToken: report.impactToken,
                review: { open: 'reroute-all', missingCurrentStage: 'refuse' },
              },
            },
            admin,
          )
          const moved = one<{ n: string }>(
            yield* runSql(sql`
              select count(*) as n from review_instances ri
              join entries e on e.id = ri.entry_id
              where e.item_id = ${g.item.id} and ri.origin = 'reroute' and ri.state = 'active'`),
          )
          return {
            open: report.review.open,
            probes: reviewerProbes(seen),
            landed: Number(moved.n),
          }
        }),
      ),
    )

    // both rounds moved, and both landed somewhere their reviewer can see
    expect(result.open).toBe(2)
    expect(result.landed).toBe(2)
    // one membership question for the step the two of them share, one
    // eligibility question each: eligibility is about the filing and cannot
    // be shared, membership is about the step and must not be asked twice
    expect(result.probes).toBe(3)
  })
})
