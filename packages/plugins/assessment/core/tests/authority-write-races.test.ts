import { Effect, Exit } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Rbac } from '@qualy/rbac-contract/effect'
import { Access } from '@qualy/plugin-rbac/server'
import { transaction } from '@qualy/plugin-database/server'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, one, refusalOf, run, runningBatch, seed, stack } from './support/round.ts'

// A queued write has not yet acquired its authority. Revoking that authority
// while it waits must leave the write refused and the domain facts unchanged.
// The blocker uses the real revocation paths and the same lock order as a
// production write; pg_stat_activity proves the tested request reached its
// lock, rather than guessing from a sleep that its old permission was read.
describe.runIf(postgresAvailable)('assessment authority under write locks', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-authority-races')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  const revokeWhileQueued = async <A, E>(
    batchId: string,
    revoke: Effect.Effect<void, E, Rbac | Access | Assessment>,
    write: () => Promise<A>,
    table = 'assessment_batches',
    tenantId?: string,
  ) => {
    let entered!: () => void
    const hasLock = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const mayRevoke = new Promise<void>((resolve) => {
      release = resolve
    })
    const blocker = Effect.runPromiseExit(
      transaction(
        Effect.gen(function* () {
          if (tenantId === undefined) {
            yield* runSql(sql`select id from assessment_batches where id = ${batchId} for update`)
          } else {
            yield* runSql(sql`select id from tenants where id = ${tenantId} for update`)
          }
          entered()
          yield* Effect.promise(() => mayRevoke)
          yield* revoke
        }),
      ).pipe(Effect.provide(stack(db.url))),
    )
    await Promise.race([
      hasLock,
      blocker.then((exit) => {
        ok(exit)
        throw new Error('the blocker ended before acquiring its lock')
      }),
    ])
    const writing = write()
    let waiting = false
    try {
      for (let attempt = 0; attempt < 150; attempt++) {
        const state = await db.query(
          `select 1 from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock'`,
        )
        if (state.rows.length > 0) {
          waiting = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    } finally {
      release()
    }
    ok(await blocker)
    const result = await writing
    expect(waiting, `the write should wait for the ${table} lock`).toBe(true)
    return result
  }

  const revokeGrant = (
    tenantId: string,
    grantId: string,
    admin: { tenantId: string; userId: string; sessionId: string },
  ) =>
    Effect.gen(function* () {
      const access = yield* Access
      const rbac = yield* Rbac
      yield* access.grants.revoke(tenantId, grantId, admin, (tenant) =>
        rbac.assertTenantKeepsAdministrator(tenant),
      )
    })

  it('does not cancel an open supplement after the batch withdrew reviewer authority', async () => {
    const world = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('authority-cancel')
          const g = yield* runningBatch(f, { profile: [...GATED, 'assessment.review.process'] })
          const assessment = yield* Assessment
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
          const asked = yield* assessment.requestSupplement(
            f.t,
            sent.currentReviewInstanceId!,
            {
              instructions: 'Please clarify',
              requirements: [{ label: 'Clarification', kind: 'text', required: true }],
            },
            f.principal(f.reviewer),
          )
          return {
            f,
            batchId: g.batch.id,
            instanceId: sent.currentReviewInstanceId!,
            requestId: asked.supplements[0]!.id,
          }
        }),
      ),
    )
    const { f, batchId, instanceId, requestId } = world
    const cancelled = await revokeWhileQueued(
      batchId,
      Effect.gen(function* () {
        const assessment = yield* Assessment
        yield* assessment.setAccessDeny(
          f.t,
          batchId,
          { userId: f.reviewer, permission: 'assessment.review.process', denied: true },
          f.principal(f.admin),
        )
      }),
      () =>
        run(
          db.url,
          Effect.gen(function* () {
            const assessment = yield* Assessment
            return yield* assessment.cancelSupplement(f.t, requestId, f.principal(f.reviewer))
          }),
        ),
    )
    expect(refusalOf(cancelled)?._tag).toBe('ASSESSMENT_REVIEW_NOT_FOUND')
    expect(
      (
        await db.row<{ state: string }>('select state from review_instances where id = $1', [
          instanceId,
        ])
      ).state,
    ).toBe('awaiting_supplement')
    expect(
      (
        await db.row<{ status: string }>(
          'select status from review_supplement_requests where id = $1',
          [requestId],
        )
      ).status,
    ).toBe('open')
  })

  it('orders supplement cancellation after an organization-side reviewer revocation', async () => {
    const world = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('authority-cancel-tenant')
          const g = yield* runningBatch(f, { profile: [...GATED, 'assessment.review.process'] })
          const assessment = yield* Assessment
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
          const asked = yield* assessment.requestSupplement(
            f.t,
            sent.currentReviewInstanceId!,
            {
              instructions: 'Please clarify',
              requirements: [{ label: 'Clarification', kind: 'text', required: true }],
            },
            f.principal(f.reviewer),
          )
          const grantId = one<{ id: string }>(
            yield* runSql(
              sql`select id from role_grants where tenant_id = ${f.t} and user_id = ${f.reviewer} and role_id = ${f.reviewRole}`,
            ),
          ).id
          return { f, batchId: g.batch.id, grantId, requestId: asked.supplements[0]!.id }
        }),
      ),
    )
    const { f, batchId, grantId, requestId } = world
    const cancelled = await revokeWhileQueued(
      batchId,
      revokeGrant(f.t, grantId, f.principal(f.admin)),
      () =>
        run(
          db.url,
          Effect.gen(function* () {
            const assessment = yield* Assessment
            return yield* assessment.cancelSupplement(f.t, requestId, f.principal(f.reviewer))
          }),
        ),
      'tenants',
      f.t,
    )
    expect(refusalOf(cancelled)?._tag).toBe('ASSESSMENT_REVIEW_NOT_FOUND')
    expect(
      (
        await db.row<{ status: string }>(
          'select status from review_supplement_requests where id = $1',
          [requestId],
        )
      ).status,
    ).toBe('open')
  })

  const managerWorld = (slug: string) =>
    Effect.gen(function* () {
      const f = yield* seed(slug)
      const g = yield* runningBatch(f)
      const office = (code: string, codes: readonly string[]) =>
        Effect.gen(function* () {
          const roleId = one<{ id: string }>(
            yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, assignable, eligibility_mode, anchor_mode)
        values (${f.t}, ${code}, ${code}, 'org', 'active', 'explicit', true, 'unrestricted', 'unrestricted') returning id`),
          ).id
          yield* runSql(
            sql`insert into role_permissions (tenant_id, role_id, permission_id) select ${f.t}, ${roleId}, id from permissions where code in (${sql.join(codes)})`,
          )
          return roleId
        })
      const managerRole = yield* office('manager', ['assessment.batch.manage'])
      const appointerRole = yield* office('appointer', ['iam.grant.manage'])
      const staffRole = yield* office('staff', ['assessment.review.process'])
      yield* runSql(
        sql`insert into role_grant_rules (tenant_id, granter_role_id, target_role_id) values (${f.t}, ${appointerRole}, ${staffRole})`,
      )
      const managerGrantId = one<{ id: string }>(
        yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
      values (${f.t}, ${f.recorder}, ${managerRole}, ${f.root}, 'subtree') returning id`),
      ).id
      // Losing the round-wide office still leaves this person able to appoint
      // at one class. That narrower authority must not administer the batch.
      yield* runSql(sql`insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
      values (${f.t}, ${f.recorder}, ${managerRole}, ${f.classA}, 'subtree'),
             (${f.t}, ${f.recorder}, ${appointerRole}, ${f.root}, 'subtree')`)
      return { f, batchId: g.batch.id, managerGrantId, staffRole }
    })

  for (const operation of ['deny', 'sync', 'add', 'remove'] as const) {
    it(`rechecks whole-batch management before ${operation} writes`, async () => {
      const world = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const world = yield* managerWorld(`authority-${operation}`)
            const { f, batchId, staffRole } = world
            const assessment = yield* Assessment
            let targetId = ''
            if (operation === 'sync') {
              targetId = one<{ id: string }>(
                yield* runSql(sql`insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.t}, ${f.s2}, ${staffRole}, ${f.classA}, 'subtree') returning id`),
              ).id
            }
            if (operation === 'remove') {
              yield* assessment.addStaff(
                f.t,
                batchId,
                { userIds: [f.s2], orgNodeIds: [f.classA], roleId: staffRole },
                f.principal(f.admin),
              )
              targetId = one<{ id: string }>(
                yield* runSql(
                  sql`select id from batch_access_sources where batch_id = ${batchId} and subject_id = ${f.s2} and origin = 'explicit'`,
                ),
              ).id
            }
            return { ...world, targetId }
          }),
        ),
      )
      const { f, batchId, managerGrantId, staffRole, targetId } = world
      const written = await revokeWhileQueued(
        batchId,
        revokeGrant(f.t, managerGrantId, f.principal(f.admin)),
        () =>
          run(
            db.url,
            Effect.gen(function* () {
              const assessment = yield* Assessment
              const manager = f.principal(f.recorder)
              switch (operation) {
                case 'deny':
                  return yield* assessment.setAccessDeny(
                    f.t,
                    batchId,
                    { userId: f.reviewer, permission: 'assessment.review.process', denied: true },
                    manager,
                  )
                case 'sync':
                  return yield* assessment.applyAccessSync(
                    f.t,
                    batchId,
                    {
                      accept: [
                        { kind: 'new', id: targetId, permissions: ['assessment.review.process'] },
                      ],
                    },
                    manager,
                  )
                case 'add':
                  return yield* assessment.addStaff(
                    f.t,
                    batchId,
                    { userIds: [f.s2], orgNodeIds: [f.classA], roleId: staffRole },
                    manager,
                  )
                case 'remove':
                  return yield* assessment.removeStaff(f.t, batchId, targetId, manager)
              }
            }),
          ),
        operation === 'remove' ? 'tenants' : 'assessment_batches',
        operation === 'remove' ? f.t : undefined,
      )
      expect(refusalOf(written)?._tag).toBe('ACCESS_DENIED')
      if (operation === 'deny') {
        expect(
          (
            await db.query(
              'select 1 from batch_access_denies where batch_id = $1 and subject_id = $2',
              [batchId, f.reviewer],
            )
          ).rows,
        ).toHaveLength(0)
      } else {
        const rows = (
          await db.query(
            'select id from batch_access_sources where batch_id = $1 and subject_id = $2',
            [batchId, f.s2],
          )
        ).rows
        expect(rows).toHaveLength(operation === 'remove' ? 1 : 0)
      }
      const after = await run(
        db.url,
        Effect.gen(function* () {
          const assessment = yield* Assessment
          return yield* assessment.listAccess(f.t, batchId, {}, f.principal(f.recorder))
        }),
      )
      expect(Exit.isFailure(after)).toBe(true)
    })
  }
})
