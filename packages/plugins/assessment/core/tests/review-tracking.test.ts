import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, run, runningBatch, seed } from './support/round.ts'

let db: Awaited<ReturnType<typeof createTestContext>>
beforeAll(async () => {
  if (postgresAvailable) db = await createTestContext('review-tracking', { migrations: 'apply' })
}, 120_000)
afterAll(async () => {
  await db?.dispose()
})

describe.runIf(postgresAvailable)('review tracking and route previews', () => {
  it('requires both entry visibility and tracking permission, then resolves live reviewers', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('tracking')
          const assessment = yield* Assessment
          const policy = {
            normal: {
              stages: [
                {
                  id: 'first',
                  label: 'First review',
                  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                  quorum: { type: 'any' },
                },
              ],
            },
            escalation: { stages: [] },
          }
          const g = yield* runningBatch(f, { profile: [...GATED, 'assessment.review.process'] })
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            f.principal(f.s1),
          )
          yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', f.principal(f.s1))
          const hidden = yield* assessment.getReviewTracking(f.t, entry.id, f.principal(f.s1))
          const visible = yield* assessment.getReviewTracking(f.t, entry.id, f.principal(f.admin))
          const preview = yield* assessment.previewReviewRoutes(
            f.t,
            g.batch.id,
            { participantId: g.p1, policy },
            f.principal(f.admin),
          )
          const deniedPreview = yield* Effect.exit(
            assessment.previewReviewRoutes(
              f.t,
              g.batch.id,
              { participantId: g.p1, policy },
              f.principal(f.s1),
            ),
          )
          yield* runSql(sql`insert into role_permissions (tenant_id, role_id, permission_id)
        select ${f.t}, ${f.reviewRole}, id from permissions where code = 'assessment.review.track'`)
          yield* runSql(sql`insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
        values (${f.t}, ${f.s1}, ${f.reviewRole}, ${f.classA}, 'self')`)
          const beforeAcceptance = yield* assessment.getReviewTracking(
            f.t,
            entry.id,
            f.principal(f.s1),
          )
          const additions = yield* assessment.previewAccessSync(
            f.t,
            g.batch.id,
            {},
            f.principal(f.admin),
          )
          yield* assessment.applyAccessSync(
            f.t,
            g.batch.id,
            {
              accept: additions.items.flatMap((change) =>
                change.kind === 'lapsed'
                  ? []
                  : [
                      {
                        kind: change.kind,
                        id: change.id,
                        permissions: change.permissions.filter(
                          (code) => code === 'assessment.review.track',
                        ),
                      },
                    ],
              ),
            },
            f.principal(f.admin),
          )
          const own = yield* assessment.getReviewTracking(f.t, entry.id, f.principal(f.s1))
          yield* assessment.setAccessDeny(
            f.t,
            g.batch.id,
            { userId: f.s1, permission: 'assessment.review.track', denied: true },
            f.principal(f.admin),
          )
          const withdrawn = yield* assessment.getReviewTracking(f.t, entry.id, f.principal(f.s1))

          const foreign = yield* Effect.exit(
            assessment.getReviewTracking(f.t, entry.id, f.principal(f.s2)),
          )
          yield* runSql(
            sql`update role_grants set revoked_at = now() where tenant_id = ${f.t} and user_id = ${f.reviewer}`,
          )
          const revoked = yield* assessment.getReviewTracking(f.t, entry.id, f.principal(f.admin))
          return {
            hidden,
            beforeAcceptance,
            withdrawn,
            visible,
            preview,
            deniedPreview,
            own,
            foreign,
            revoked,
            reviewer: f.reviewer,
          }
        }),
      ),
    )
    expect(result.hidden).toEqual({ available: false })
    expect(result.beforeAcceptance).toEqual({ available: false })
    expect(result.withdrawn).toEqual({ available: false })
    expect(result.visible.available).toBe(true)
    if (!result.visible.available || !result.own.available || !result.revoked.available)
      throw new Error('tracking unavailable')
    expect(
      result.visible.stages.find((stage) => stage.current)?.reviewers.map((person) => person.id),
    ).toEqual([result.reviewer])
    expect(result.preview.stages[0]?.reviewers.map((person) => person.id)).toEqual([
      result.reviewer,
    ])
    expect(Exit.isFailure(result.deniedPreview)).toBe(true)
    expect(result.own.stages).toEqual(result.visible.stages)
    expect(Exit.isFailure(result.foreign)).toBe(true)
    expect(result.revoked.stages.find((stage) => stage.current)?.reviewers).toEqual([])
    expect(result.revoked.stages.find((stage) => stage.current)?.blockedReason).toBe('no-assignee')
  })
})
