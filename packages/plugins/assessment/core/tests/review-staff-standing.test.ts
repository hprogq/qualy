import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, one, run, runningBatch, seed } from './support/round.ts'

let db: Awaited<ReturnType<typeof createTestContext>>
beforeAll(async () => {
  if (postgresAvailable)
    db = await createTestContext('review-staff-standing', { migrations: 'apply' })
}, 120_000)
afterAll(async () => {
  await db?.dispose()
})

describe.runIf(postgresAvailable)('review membership and staff standing', () => {
  it('accepts a self-only appointment on an ancestor stage, and observes its revocation everywhere', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ancestor-stage')
          const assessment = yield* Assessment
          const staffType = one<{ id: string }>(
            yield* runSql(sql`insert into user_types (tenant_id, code, name, placement_mode)
        values (${f.t}, 'staff', 'Staff', 'unrestricted') returning id`),
          ).id
          yield* runSql(sql`update users set user_type_id = ${staffType} where tenant_id = ${f.t}
        and id not in (${f.s1}, ${f.s2}, ${f.s3})`)
          const college = one<{ id: string; org_type_id: string }>(
            yield* runSql(sql`
        select id, org_type_id from org_nodes where tenant_id = ${f.t} and name = 'College A'`),
          )
          yield* runSql(sql`update role_grants set org_node_id = ${college.id}
        where tenant_id = ${f.t} and user_id = ${f.reviewer} and role_id = ${f.reviewRole}`)
          // Reopening is an ordinary scoped permission, unlike exact stage membership.
          yield* runSql(sql`insert into role_permissions (tenant_id, role_id, permission_id)
        select ${f.t}, ${f.reviewRole}, id from permissions where code = 'assessment.review.reopen'`)
          const g = yield* runningBatch(f, {
            profile: [...GATED, 'assessment.review.process'],
            stages: [
              {
                id: 'college',
                selector: {
                  kind: 'roleAt',
                  nodeTypeId: college.org_type_id,
                  roleIds: [f.reviewRole],
                },
                quorum: { type: 'any' },
              },
            ],
          })
          const admin = f.principal(f.admin)
          const before = yield* assessment.listAccess(f.t, g.batch.id, {}, admin)
          expect(before.staff.find((row) => row.userId === f.reviewer)?.sources[0]).toMatchObject({
            active: true,
            lapse: null,
            current: ['assessment.review.process'],
          })
          const plan = yield* assessment.previewAccessSync(f.t, g.batch.id, {}, admin)
          const coverage = yield* assessment.reviewCoverage(
            f.t,
            g.batch.id,
            { nodeTypeId: college.org_type_id, roleIds: [f.reviewRole] },
            admin,
          )
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            f.principal(f.s1),
          )
          const sent = yield* assessment.setEntryStatus(
            f.t,
            entry.id,
            'in_review',
            f.principal(f.s1),
          )
          const readable = yield* assessment.getReviewInstance(
            f.t,
            sent.currentReviewInstanceId!,
            f.principal(f.reviewer),
          )
          yield* runSql(sql`update role_grants set revoked_at = now()
        where tenant_id = ${f.t} and user_id = ${f.reviewer} and role_id = ${f.reviewRole}`)
          const after = yield* assessment.listAccess(f.t, g.batch.id, {}, admin)
          const refused = yield* Effect.exit(
            assessment.getReviewInstance(
              f.t,
              sent.currentReviewInstanceId!,
              f.principal(f.reviewer),
            ),
          )
          const patrol = yield* assessment.patrolReviewRounds
          const alerts = yield* assessment.reviewAlerts(f.t, g.batch.id, admin)
          return { f, college, before, after, plan, coverage, readable, refused, patrol, alerts }
        }),
      ),
    )
    const source = result.before.staff.find((row) => row.userId === result.f.reviewer)?.sources[0]
    expect(source).toMatchObject({
      active: true,
      lapse: null,
      current: ['assessment.review.process'],
    })
    expect(
      result.plan.items
        .filter((row) => row.kind === 'lapsed' && row.userId === result.f.reviewer)
        .flatMap((row) => row.permissions),
    ).not.toContain('assessment.review.process')
    expect(result.coverage.nodes.find((node) => node.id === result.college.id)?.reviewers).toBe(1)
    expect(result.readable.actions.approve.state).toBe('available')
    expect(
      result.after.staff.find((row) => row.userId === result.f.reviewer)?.sources[0],
    ).toMatchObject({ active: false, lapse: 'revoked' })
    expect(Exit.isFailure(result.refused)).toBe(true)
    expect(result.patrol.blocked).toBe(1)
    expect(result.alerts.groups).toContainEqual(
      expect.objectContaining({ nodeId: result.college.id, waiting: 1, reason: 'no-assignee' }),
    )
  })
})
