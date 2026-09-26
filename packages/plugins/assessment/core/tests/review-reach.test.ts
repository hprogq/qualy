import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import {
  enterableFrom,
  resolvePolicy,
  routeReaches,
  type PolicyStage,
  type ReviewPolicy,
} from '../src/review/chain.ts'
import { ok, one, run, runningBatch, seed, type Seeded } from './support/round.ts'

// A route whose every step asks for a kind of unit somebody sits under none
// of has nowhere to stand for them: their submission is refused, and no
// appointment mends it. The screens say so before anybody files, reading the
// configuration and the frozen lineage alone.

describe.runIf(postgresAvailable)('routes with nowhere to stand', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-review-reach')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  const classStep = (f: Seeded, id = 'class'): PolicyStage => ({
    id,
    selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
    quorum: { type: 'any' },
  })

  const lineageOf = (batchId: string, userId: string) =>
    Effect.map(
      runSql(sql`
        select anchor_lineage from batch_participants
        where batch_id = ${batchId} and user_id = ${userId}`),
      (result) =>
        (result as { rows: { anchor_lineage: { nodeId: string; nodeTypeId: string }[] }[] })
          .rows[0]!.anchor_lineage,
    )

  // The screens read reachability off the configuration without resolving
  // it; the write resolves it. The two must agree on every route and every
  // lineage, or a key is offered that the write refuses.
  it('answers exactly as resolving the route would, lineage by lineage', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('reach-agree')
          const g = yield* runningBatch(f)
          const college = one<{ id: string }>(
            yield* runSql(sql`select org_type_id as id from org_nodes where id = ${f.root}`),
          ).id
          const collegeStep: PolicyStage = {
            id: 'college',
            selector: { kind: 'roleAt', nodeTypeId: college, roleIds: [f.reviewRole] },
            quorum: { type: 'any' },
          }
          const nearest: PolicyStage = {
            id: 'nearest',
            selector: { kind: 'nearestRole', roleId: f.reviewRole },
            quorum: { type: 'any' },
          }
          const nowhere: PolicyStage = {
            id: 'nowhere',
            selector: { kind: 'roleAt', nodeTypeId: crypto.randomUUID(), roleIds: [f.reviewRole] },
            quorum: { type: 'any' },
          }
          const routes: readonly (readonly PolicyStage[])[] = [
            [classStep(f)],
            [collegeStep],
            [classStep(f), collegeStep],
            [nowhere],
            [nowhere, classStep(f)],
            [nearest],
            [nowhere, nearest],
            [],
          ]
          const answers: { reads: boolean; resolves: boolean }[] = []
          for (const userId of [f.admin, f.recorder, f.s1, f.s3]) {
            const lineage = yield* lineageOf(g.batch.id, userId)
            for (const stages of routes) {
              const policy: ReviewPolicy = { normal: stages, escalation: stages }
              const resolved = yield* resolvePolicy({
                tenantId: f.t,
                batchId: g.batch.id,
                policy,
                lineage,
              })
              answers.push({
                reads: routeReaches(stages, lineage),
                resolves: enterableFrom(resolved, 'normal', 0) !== null,
              })
              answers.push({
                reads: routeReaches(stages, lineage),
                resolves: enterableFrom(resolved, 'escalation', 0) !== null,
              })
            }
          }
          return answers
        }),
      ),
    )
    // both answers occur, so the agreement is not an agreement about one of them
    expect(result.some((answer) => answer.reads)).toBe(true)
    expect(result.some((answer) => !answer.reads)).toBe(true)
    for (const answer of result) expect(answer.reads).toBe(answer.resolves)
  })
})
