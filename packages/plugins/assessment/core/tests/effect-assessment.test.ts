import { randomUUID } from 'node:crypto'
import { inspect } from 'node:util'
import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { Rbac } from '@qualy/rbac-contract/effect'
import type { Orm } from '@qualy/plugin-database/server'
import { entities } from '../src/db/entities.ts'
import { permissions as assessmentPermissions } from '../src/permissions.ts'
import { Assessment, serviceLayer, type PhaseSpecInput } from '../src/server/index.ts'
import type { PhaseRow } from '../src/server/db.ts'
import { startBatch } from './support/lifecycle.ts'

// The service against a real database: batch lifecycle with the one-statement
// roster, plan edits landing as audited events, manual and forced advancement,
// idempotent ratification, and the gate over real scope rows. These are the
// milestone's acceptance items for the service layer.

const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  { owner: 'assessment', permissions: assessmentPermissions },
])

const closure = [...orgEntities, ...authEntities, ...rbacEntities, ...entities] as const

const stack = (url: string) =>
  serviceLayer.pipe(
    Layer.provideMerge(
      booted(
        rbacLayer.pipe(
          Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
        ),
        { catalog },
      ),
    ),
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Assessment | Rbac | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

/** the cause's live entries; the object exposes `reasons`, its json `failures` */
const reasonsOf = (exit: Exit.Exit<unknown, unknown>): readonly { error?: unknown }[] =>
  Exit.isFailure(exit)
    ? ((exit.cause as { reasons?: readonly { error?: unknown }[] }).reasons ?? [])
    : []

const tagOf = (exit: Exit.Exit<unknown, unknown>): string | undefined =>
  reasonsOf(exit)
    .map((entry) => (entry.error as { _tag?: string } | undefined)?._tag)
    .find((tag) => tag !== undefined)

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows

const HOUR = 3_600_000

/** a college with one grade of two classes, another grade, and the people */
const seed = (slug: string) =>
  Effect.gen(function* () {
    const tenant = one<{ id: string }>(
      yield* runSql(sql`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`),
    ).id
    const type = (code: string) =>
      Effect.map(
        runSql(sql`
          insert into org_types (tenant_id, code, name)
          values (${tenant}, ${code}, ${code}) returning id`),
        (result) => one<{ id: string }>(result).id,
      )
    const collegeType = yield* type('college')
    const gradeType = yield* type('grade')
    const classType = yield* type('class')
    const node = (
      typeId: string,
      parent: string | null,
      name: string,
      path: string,
      depth: number,
    ) =>
      Effect.map(
        runSql(sql`
          insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
          values (${tenant}, ${typeId}, ${parent}, ${name}, ${path}, ${depth}) returning id`),
        (result) => one<{ id: string }>(result).id,
      )
    const root = yield* node(collegeType, null, 'College', 'r', 0)
    const gradeA = yield* node(gradeType, root, 'Grade A', 'r.a', 1)
    const gradeB = yield* node(gradeType, root, 'Grade B', 'r.b', 1)
    const class1 = yield* node(classType, gradeA, 'Class 1', 'r.a.c1', 2)
    const class2 = yield* node(classType, gradeA, 'Class 2', 'r.a.c2', 2)
    const class3 = yield* node(classType, gradeB, 'Class 3', 'r.b.c3', 2)

    const userType = (code: string) =>
      Effect.map(
        runSql(sql`
          insert into user_types (tenant_id, code, name, placement_mode)
          values (${tenant}, ${code}, ${code}, 'unrestricted') returning id`),
        (result) => one<{ id: string }>(result).id,
      )
    const studentType = yield* userType('student')
    const teacherType = yield* userType('teacher')
    const person = (name: string, typeId: string, nodeId: string, enabled = true) =>
      Effect.map(
        runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, enabled)
          values (${tenant}, ${name}, ${typeId}, ${nodeId}, ${enabled}) returning id`),
        (result) => one<{ id: string }>(result).id,
      )
    const s1 = yield* person('S1', studentType, class1)
    const s2 = yield* person('S2', studentType, class2)
    const s3 = yield* person('S3', studentType, class3)
    yield* person('T1', teacherType, class1)
    yield* person('Gone', studentType, class1, false)

    const admin = yield* person('Admin', teacherType, root)
    const adminRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
        values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
        returning id`),
    ).id
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id)
      values (${tenant}, ${admin}, ${adminRole})`)

    const principal: Principal = { tenantId: tenant, userId: admin, sessionId: 's' }
    return {
      tenant,
      collegeType,
      gradeType,
      classType,
      root,
      gradeA,
      gradeB,
      class1,
      class2,
      class3,
      studentType,
      teacherType,
      s1,
      s2,
      s3,
      principal,
    }
  })

const phase = (over: Partial<PhaseSpecInput> & { phaseKey: string }): PhaseSpecInput => ({
  displayName: over.phaseKey,
  permissionProfile: [],
  ...over,
})

const toSpec = (row: PhaseRow): PhaseSpecInput => ({
  id: row.id,
  phaseKey: row.phaseKey,
  displayName: row.displayName,
  description: row.description,
  permissionProfile: row.permissionProfile,
})

describe.runIf(postgresAvailable).concurrent('the assessment service', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-service')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('runs a batch from template to activation and freezes the roster in one statement', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('life')
        const assessment = yield* Assessment

        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: '2026 spring',
            // two classes from different grades: the "classes 1 and 3 report,
            // class 2 does not" shape a single subtree cannot express
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.class1, f.class3], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        const template = yield* assessment.createTemplate(
          f.tenant,
          {
            name: 'default',
            phases: [
              phase({
                phaseKey: 'entry',
                permissionProfile: ['assessment.entry.create', 'assessment.entry.submit'],
              }),
              phase({ phaseKey: 'review', permissionProfile: ['assessment.review.process'] }),
              phase({ phaseKey: 'archive' }),
            ],
          },
          f.principal,
        )
        const applied = yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          { fromTemplateId: template.id },
          f.principal,
        )
        // committing the first phase is what starts the batch, and what
        // freezes the roster as of that transaction
        yield* startBatch(f.tenant, batch.id, f.principal)
        const activated = yield* assessment.getBatch(f.tenant, batch.id, f.principal)
        const roster = rowsOf<{
          user_id: string
          anchor_path: string
          anchor_lineage: readonly { nodeId: string; nodeTypeId: string }[]
        }>(
          yield* runSql(sql`
            select user_id, anchor_path, anchor_lineage from batch_participants
            where batch_id = ${batch.id} order by anchor_path`),
        )
        return { batch, applied, activated, roster, f }
      }),
    )
    const { batch, applied, activated, roster, f } = ok(exit)
    expect(batch.status).toBe('draft')
    expect(batch.materialRange).toEqual({ start: '2026-03-01', end: '2026-09-01' })
    // provenance lands with the copy
    expect(applied.phases.map((row) => row.sourceTemplateVersion)).toEqual([1, 1, 1])
    expect(activated.status).toBe('active')
    // enrolled students under any scope node only: the unselected class, the
    // teacher and the disabled account stay out
    expect(roster.map((row) => row.user_id).sort()).toEqual([f.s1, f.s3].sort())
    const s1Row = roster.find((row) => row.user_id === f.s1)!
    expect(s1Row.anchor_lineage).toEqual([
      { nodeId: f.class1, nodeTypeId: f.classType },
      { nodeId: f.gradeA, nodeTypeId: f.gradeType },
      { nodeId: f.root, nodeTypeId: f.collegeType },
    ])
  })

  it('refuses to start a batch with nobody in it', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('nobody')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Empty',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            // a selection that matches nobody: the round is created, and it
            // is empty
            import: { orgNodeIds: [f.root], userTypeIds: [] },
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          { specs: [phase({ phaseKey: 'archive' })] },
          f.principal,
        )
        // starting is committing the first phase to a time, and a round with
        // nobody in it has nothing to start
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        return yield* assessment.schedulePhase(
          f.tenant,
          batch.id,
          plan[0]!.id,
          Date.now() + HOUR,
          f.principal,
        )
      }),
    )
    expect(tagOf(exit)).toBe('ASSESSMENT_BATCH_NO_PARTICIPANTS')
  })

  it('commits times from the top down, withdraws them from the bottom up', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('edits')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Edits',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              phase({ phaseKey: 'entry', permissionProfile: ['assessment.entry.submit'] }),
              phase({ phaseKey: 'review' }),
              phase({ phaseKey: 'archive' }),
            ],
          },
          f.principal,
        )
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)

        // the second phase cannot take a time while the first has none
        const outOfOrder = yield* Effect.exit(
          assessment.schedulePhase(f.tenant, batch.id, plan[1]!.id, Date.now() + HOUR, f.principal),
        )
        // in order, it is accepted, and the audit says so
        yield* assessment.schedulePhase(
          f.tenant,
          batch.id,
          plan[0]!.id,
          Date.now() + HOUR,
          f.principal,
        )
        yield* assessment.schedulePhase(
          f.tenant,
          batch.id,
          plan[1]!.id,
          Date.now() + 3 * HOUR,
          f.principal,
        )
        const audited = rowsOf<{ kind: string }>(
          yield* runSql(sql`
            select kind from phase_events where phase_id = ${plan[0]!.id} and kind = 'scheduled'`),
        )

        // and a time comes back off the end, never out of the middle
        const middle = yield* Effect.exit(
          assessment.schedulePhase(f.tenant, batch.id, plan[0]!.id, null, f.principal),
        )
        yield* assessment.schedulePhase(f.tenant, batch.id, plan[1]!.id, null, f.principal)
        const after = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        return { outOfOrder, audited, middle, after }
      }),
    )
    const { outOfOrder, audited, middle, after } = ok(exit)
    const refusalsIn = (result: typeof outOfOrder) =>
      reasonsOf(result)
        .flatMap(
          (entry) =>
            (entry.error as { refusals?: readonly { reason: string }[] } | undefined)?.refusals ??
            [],
        )
        .map((entry) => entry.reason)
    expect(refusalsIn(outOfOrder)).toContain('schedule-out-of-order')
    expect(audited).toHaveLength(1)
    expect(refusalsIn(middle)).toContain('unschedule-not-from-tail')
    expect(after.map((row) => row.plannedEntryAt)).toEqual([after[0]!.plannedEntryAt, null, null])
    expect(after[0]!.plannedEntryAt).not.toBeNull()
  })

  it('grows a running plan past its last phase, even when that phase runs', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('append')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Append',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        // the trap case: one phase, activated, and that phase is in progress -
        // "current" and "last" are the same row
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          { specs: [phase({ phaseKey: 'entry', permissionProfile: ['assessment.entry.submit'] })] },
          f.principal,
        )
        let plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        // entering the first phase is how a batch starts: no separate act
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)
        plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              ...plan.map(toSpec),
              phase({
                phaseKey: 'review',
              }),
            ],
          },
          f.principal,
        )
        return yield* assessment.getPlan(f.tenant, batch.id, f.principal)
      }),
    )
    const grown = ok(exit)
    expect(grown.map((row) => row.phaseKey)).toEqual(['entry', 'review'])
    expect(grown[0]!.actualEntryAt).not.toBeNull()
    expect(grown[1]!.plannedEntryAt).toBeNull()
  })

  it('advances manually, demands force and a reason for early boundaries, and archives at the terminal', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('advance')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Advance',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              phase({ phaseKey: 'entry' }),
              phase({ phaseKey: 'review' }),
              phase({ phaseKey: 'archive' }),
            ],
          },
          f.principal,
        )
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        // an unscheduled phase promised nobody a time, so entering it by
        // hand is simply how a batch is moved along
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)

        const wrongTarget = yield* Effect.exit(
          assessment.advancePhase(f.tenant, batch.id, { to: plan[2]!.id }, f.principal),
        )
        // once a phase has a time, entering it early overrides that promise
        yield* assessment.schedulePhase(
          f.tenant,
          batch.id,
          plan[1]!.id,
          Date.now() + 3 * HOUR,
          f.principal,
        )
        const unforced = yield* Effect.exit(
          assessment.advancePhase(f.tenant, batch.id, { to: plan[1]!.id }, f.principal),
        )
        const unreasoned = yield* Effect.exit(
          assessment.advancePhase(
            f.tenant,
            batch.id,
            { to: plan[1]!.id, force: true },
            f.principal,
          ),
        )
        const forced = yield* assessment.advancePhase(
          f.tenant,
          batch.id,
          { to: plan[1]!.id, force: true, reason: 'deadline moved by the college' },
          f.principal,
        )
        const audit = one<{ reason: string; actor_id: string }>(
          yield* runSql(sql`
            select reason, actor_id from phase_events
            where phase_id = ${plan[1]!.id} and kind = 'entered'`),
        )
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[2]!.id }, f.principal)
        const archived = yield* assessment.setBatchStatus(
          f.tenant,
          batch.id,
          { status: 'archived' },
          f.principal,
        )
        const readOnly = yield* Effect.exit(
          assessment.updateBatch(f.tenant, batch.id, { name: 'nope' }, f.principal),
        )
        return { wrongTarget, unforced, unreasoned, forced, audit, archived, readOnly, f }
      }),
    )
    const { wrongTarget, unforced, unreasoned, forced, audit, archived, readOnly, f } = ok(exit)
    expect(tagOf(wrongTarget)).toBe('ASSESSMENT_ADVANCE_INVALID')
    expect(tagOf(unforced)).toBe('ASSESSMENT_ADVANCE_INVALID')
    expect(tagOf(unreasoned)).toBe('ASSESSMENT_ADVANCE_INVALID')
    expect(forced.find((row) => row.phaseKey === 'review')!.actualEntryAt).not.toBeNull()
    expect(audit.reason).toBe('deadline moved by the college')
    expect(audit.actor_id).toBe(f.principal.userId)
    expect(archived.status).toBe('archived')
    expect(tagOf(readOnly)).toBe('ASSESSMENT_BATCH_READ_ONLY')
  })

  it('starts by scheduling, unstarts by withdrawing, and deletes only what never ran', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('lifecycle')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Lifecycle',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          { specs: [phase({ phaseKey: 'entry' }), phase({ phaseKey: 'archive' })] },
          f.principal,
        )
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        const rosterSize = () =>
          runSql<{ count: string }>(
            sql`select count(*)::text as count from batch_participants where batch_id = ${batch.id}`,
          ).pipe(Effect.map((rows) => Number(one<{ count: string }>(rows).count)))

        // a draft has promised nothing, but its roster exists: it was drawn
        // when the batch was created, so somebody can check it before it runs
        const asDraft = {
          status: (yield* assessment.getBatch(f.tenant, batch.id, f.principal)).status,
          roster: yield* rosterSize(),
        }

        // the first commitment: the batch runs from here, and the roster is
        // frozen as of this transaction
        yield* assessment.schedulePhase(
          f.tenant,
          batch.id,
          plan[0]!.id,
          Date.now() + HOUR,
          f.principal,
        )
        const committed = {
          status: (yield* assessment.getBatch(f.tenant, batch.id, f.principal)).status,
          roster: yield* rosterSize(),
        }

        // and a batch that has started cannot be deleted... except this one
        // never actually entered a phase, so withdrawing releases the promise
        const whileCommitted = yield* Effect.exit(
          assessment.deleteBatch(f.tenant, batch.id, f.principal),
        )
        yield* assessment.schedulePhase(f.tenant, batch.id, plan[0]!.id, null, f.principal)
        const withdrawn = {
          status: (yield* assessment.getBatch(f.tenant, batch.id, f.principal)).status,
          roster: yield* rosterSize(),
        }

        // archiving is refused until the last phase has actually been entered
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)
        const tooEarly = yield* Effect.exit(
          assessment.setBatchStatus(f.tenant, batch.id, { status: 'archived' }, f.principal),
        )
        // and once something has run, the batch is history rather than setup
        const afterRunning = yield* Effect.exit(
          assessment.deleteBatch(f.tenant, batch.id, f.principal),
        )
        return { asDraft, committed, whileCommitted, withdrawn, tooEarly, afterRunning, f, batch }
      }),
    )
    const { asDraft, committed, whileCommitted, withdrawn, tooEarly, afterRunning } = ok(exit)
    expect(asDraft.status).toBe('draft')
    expect(asDraft.roster).toBeGreaterThan(0)
    expect(committed.status).toBe('active')
    expect(committed.roster).toBe(asDraft.roster)
    expect(tagOf(whileCommitted)).toBe('ASSESSMENT_BATCH_STATUS_INVALID')
    // back to a draft, and the roster stays: the promise was released, not
    // the preparation
    expect(withdrawn).toEqual({ status: 'draft', roster: asDraft.roster })
    expect(tagOf(tooEarly)).toBe('ASSESSMENT_BATCH_STATUS_INVALID')
    expect(tagOf(afterRunning)).toBe('ASSESSMENT_BATCH_STATUS_INVALID')
  })

  it('accepts what the tenant offers when the batch is created, and no more after', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('acceptance')
        const assessment = yield* Assessment
        // a tutor with two of the capabilities a batch may carry
        const role = one<{ id: string }>(
          yield* runSql(sql`
            insert into roles (tenant_id, code, name, kind, status, permission_mode)
            values (${f.tenant}, 'tutor', 'Tutor', 'org', 'active', 'explicit') returning id`),
        ).id
        const permissionId = (code: string) =>
          Effect.map(
            runSql(sql`select id from permissions where code = ${code}`),
            (result) => one<{ id: string }>(result).id,
          )
        const carry = (code: string) =>
          Effect.gen(function* () {
            const id = yield* permissionId(code)
            yield* runSql(sql`insert into role_permissions (tenant_id, role_id, permission_id)
              values (${f.tenant}, ${role}, ${id})`)
          })
        yield* carry('assessment.review.process')
        yield* carry('assessment.entry.proxy')
        const tutor = one<{ id: string }>(
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.tenant}, 'Tutor', ${f.teacherType}, ${f.gradeA}) returning id`),
        ).id
        const assignment = one<{ id: string }>(
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${tutor}, ${role}, ${f.gradeA}, 'subtree') returning id`),
        ).id

        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Acceptance',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.gradeA], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        // the batch took the tutor's two capabilities on when it was created
        const atCreation = yield* assessment.listAccess(f.tenant, batch.id, f.principal)

        // the tenant now widens the role and narrows the assignment's reach in
        // one go: a capability added, a capability taken away
        yield* carry('assessment.publication.manage')
        yield* runSql(sql`
          delete from role_permissions rp using permissions p
          where p.id = rp.permission_id and rp.role_id = ${role}
            and p.code = 'assessment.entry.proxy'`)
        const afterTenantEdit = yield* assessment.listAccess(f.tenant, batch.id, f.principal)
        const plan = yield* assessment.previewAccessSync(f.tenant, batch.id, {}, f.principal)

        // taking one back is this batch's own decision, and it outlives a sync
        yield* assessment.setAccessDeny(
          f.tenant,
          batch.id,
          { userId: tutor, permission: 'assessment.review.process', denied: true },
          f.principal,
        )
        const afterDeny = yield* assessment.listAccess(f.tenant, batch.id, f.principal)
        // only what was chosen: the widening is taken, and a second change
        // nobody ticked would stay where it is
        const merged = yield* assessment.applyAccessSync(
          f.tenant,
          batch.id,
          {
            accept: plan.items
              .filter((change) => change.kind === 'widened')
              .map((change) => ({
                kind: 'widened' as const,
                id: change.id,
                permissions: change.permissions,
              })),
          },
          f.principal,
        )
        const afterSync = yield* assessment.listAccess(f.tenant, batch.id, f.principal)

        // and revoking the assignment takes everything it carried with it
        yield* runSql(sql`update role_grants set revoked_at = now() where id = ${assignment}`)
        const afterRevoke = yield* assessment.listAccess(f.tenant, batch.id, f.principal)

        return {
          atCreation,
          afterTenantEdit,
          plan,
          afterDeny,
          merged,
          afterSync,
          afterRevoke,
          tutor,
        }
      }),
    )
    const { atCreation, afterTenantEdit, plan, afterDeny, merged, afterSync, afterRevoke, tutor } =
      ok(exit)
    const kind = (want: 'new' | 'widened' | 'lapsed') =>
      plan.items.filter((change) => change.kind === want).flatMap((change) => change.permissions)
    const of = (access: { staff: readonly { userId: string; effective: readonly string[] }[] }) =>
      access.staff.find((row) => row.userId === tutor)?.effective ?? []

    expect(of(atCreation)).toEqual(['assessment.entry.proxy', 'assessment.review.process'])
    // withdrawing takes effect at once; widening does not arrive on its own
    expect(of(afterTenantEdit)).toEqual(['assessment.review.process'])
    expect(kind('widened')).toEqual(['assessment.publication.manage'])
    expect(kind('lapsed')).toEqual(['assessment.entry.proxy'])
    // a withdrawal is reported but never offered for approval, so the counts
    // separate the errand that needs a decision from the one that does not
    expect(plan.pendingTotal).toBe(1)
    expect(plan.lapsedTotal).toBe(1)
    expect(of(afterDeny)).toEqual([])
    // the synchronisation accepts the new capability, and leaves the refusal
    expect(merged).toEqual({ merged: 1 })
    expect(of(afterSync)).toEqual(['assessment.publication.manage'])
    expect(of(afterRevoke)).toEqual([])
  })

  it('offers only roles a batch may carry, at units the batch actually covers', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('staff-options')
        const assessment = yield* Assessment
        const role = (code: string, codes: readonly string[]) =>
          Effect.gen(function* () {
            const id = one<{ id: string }>(
              yield* runSql(sql`
                insert into roles (tenant_id, code, name, kind, status, permission_mode,
                                   assignable, eligibility_mode, anchor_mode)
                values (${f.tenant}, ${code}, ${code}, 'org', 'active', 'explicit', true,
                        'unrestricted', 'unrestricted')
                returning id`),
            ).id
            for (const permission of codes) {
              yield* runSql(sql`
                insert into role_permissions (tenant_id, role_id, permission_id)
                select ${f.tenant}, ${id}, id from permissions where code = ${permission}`)
            }
            return id
          })
        // one a batch may carry, one that reaches beyond it
        const reviewer = yield* role('reviewer', ['assessment.review.process'])
        yield* role('boss', ['assessment.review.process', 'assessment.batch.manage'])
        const teacher = one<{ id: string }>(
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.tenant}, 'Teacher', ${f.teacherType}, ${f.class1}) returning id`),
        ).id

        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Staffing',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.class1], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        const units = yield* assessment.staffOptions(f.tenant, batch.id, {}, f.principal)
        const here = yield* assessment.staffOptions(
          f.tenant,
          batch.id,
          { userId: teacher, orgNodeId: f.class1 },
          f.principal,
        )
        // a unit this round has nobody in is not a place to hand out authority
        const elsewhere = yield* assessment.staffOptions(
          f.tenant,
          batch.id,
          { userId: teacher, orgNodeId: f.class3 },
          f.principal,
        )
        // and the write refuses it too, not only the list
        const written = yield* Effect.exit(
          assessment.addStaff(
            f.tenant,
            batch.id,
            { userId: teacher, roleId: reviewer, orgNodeId: f.class3 },
            f.principal,
          ),
        )
        return { units, here, elsewhere, reviewer, written }
      }),
    )
    const { units, here, elsewhere, reviewer, written } = ok(exit)
    // where the people stand, and every unit above them: a college reviewer
    // has to be appointable once rather than class by class
    expect(units.nodes.map((node) => node.name)).toEqual(['College', 'Grade A', 'Class 1'])
    expect(units.roles).toEqual([])
    // the role carrying batch administration is shown and refused, not hidden:
    // "reaches beyond this batch" is something somebody can act on
    expect(here.roles.filter((role) => role.refusal === null).map((role) => role.id)).toEqual([
      reviewer,
    ])
    expect(here.roles.find((role) => role.id !== reviewer)?.refusal).toBe('beyond-batch')
    expect(elsewhere.roles).toEqual([])
    expect(reasonsOf(written).map((entry) => (entry.error as { reason?: string }).reason)).toEqual([
      'node-out-of-batch',
    ])
  })

  it('shows a participant their own running batch and nobody else\u2019s draft', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('visibility')
        const assessment = yield* Assessment
        const student: Principal = { tenantId: f.tenant, userId: f.s1, sessionId: 's' }

        const running = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Running',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.class1], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          running.id,
          { specs: [phase({ phaseKey: 'entry' })] },
          f.principal,
        )
        const plan = yield* assessment.getPlan(f.tenant, running.id, f.principal)
        // scheduling the first stage is what starts a batch
        yield* assessment.schedulePhase(
          f.tenant,
          running.id,
          plan[0]!.id,
          Date.now() + HOUR,
          f.principal,
        )
        // a second one, left as a draft: its people have not been told about it
        yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Draft',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.class1], userTypeIds: [f.studentType] },
          },
          f.principal,
        )

        const page = { limit: 20 }
        const asAdmin = yield* assessment.listBatches(f.tenant, page, f.principal)
        const asStudent = yield* assessment.listBatches(f.tenant, page, student)
        const stranger: Principal = { tenantId: f.tenant, userId: f.s3, sessionId: 's' }
        const asStranger = yield* assessment.listBatches(f.tenant, page, stranger)
        const opened = yield* assessment.getBatch(f.tenant, running.id, student)
        const refused = yield* Effect.exit(assessment.getBatch(f.tenant, running.id, stranger))
        return { asAdmin, asStudent, asStranger, opened, refused }
      }),
    )
    const { asAdmin, asStudent, asStranger, opened, refused } = ok(exit)
    const names = (rows: readonly { name: string }[]) => rows.map((row) => row.name).sort()

    // the administrator sees the round being written as well as the one running
    expect(names(asAdmin)).toEqual(['Draft', 'Running'])
    // the student sees the one they are actually in, and reads it without
    // holding any permission over batches at all
    expect(names(asStudent)).toEqual(['Running'])
    expect(asStudent[0]!.manageable).toBe(false)
    expect(opened.name).toBe('Running')
    // and somebody in neither sees nothing, by id or otherwise
    expect(asStranger).toEqual([])
    expect(tagOf(refused)).toBe('ACCESS_DENIED')
  })

  it('reopens an archived batch into a new phase, and says why in the record', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('reopen')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Reopen',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          { specs: [phase({ phaseKey: 'entry' })] },
          f.principal,
        )
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)
        yield* assessment.setBatchStatus(
          f.tenant,
          batch.id,
          { status: 'archived', reason: 'the year is over' },
          f.principal,
        )

        // reopening without saying why is exactly what must not be possible
        const silent = yield* Effect.exit(
          assessment.setBatchStatus(
            f.tenant,
            batch.id,
            {
              status: 'active',
              reason: '   ',
              phase: { displayName: 'Supplementary' },
              plannedEntryAt: null,
            },
            f.principal,
          ),
        )
        const reopened = yield* assessment.setBatchStatus(
          f.tenant,
          batch.id,
          {
            status: 'active',
            reason: 'materials were missed',
            phase: { displayName: 'Supplementary submission' },
            plannedEntryAt: null,
          },
          f.principal,
        )
        const after = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        const events = rowsOf<{ kind: string; reason: string | null }>(
          yield* runSql(sql`
            select kind, reason from batch_lifecycle_events
            where batch_id = ${batch.id} order by occurred_at`),
        )
        return { silent, reopened, after, events, f }
      }),
    )
    const { silent, reopened, after, events } = ok(exit)
    expect(tagOf(silent)).toBe('ASSESSMENT_BATCH_STATUS_INVALID')
    expect(reopened.status).toBe('active')
    // the phases that ran are untouched; what reopening adds is a new one,
    // running from the moment the batch was opened again
    expect(after).toHaveLength(2)
    expect(after[0]!.actualEntryAt).not.toBeNull()
    expect(after[1]!.displayName).toBe('Supplementary submission')
    expect(after[1]!.actualEntryAt).not.toBeNull()
    expect(reopened.currentPhaseId).toBe(after[1]!.id)
    expect(events.map((row) => row.kind)).toEqual(['archived', 'reopened'])
    expect(events[1]!.reason).toBe('materials were missed')
  })

  it('ratifies a due boundary once, with its planned instant, however late', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('ratify')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Ratify',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        const planned = Date.now() + 1_200
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              phase({
                phaseKey: 'entry',
                permissionProfile: ['assessment.entry.submit'],
              }),
              phase({ phaseKey: 'archive', permissionProfile: ['assessment.review.process'] }),
            ],
          },
          f.principal,
        )
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.schedulePhase(f.tenant, batch.id, plan[0]!.id, planned, f.principal)

        // before the boundary: no phase in effect, the gate fails closed
        const before = yield* assessment.gate(f.tenant, batch.id, 'assessment.entry.submit')

        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1_400)))

        // after it: the clock says entered, materialized or not
        const after = yield* assessment.gate(f.tenant, batch.id, 'assessment.entry.submit')

        // advancing to the archive ratifies the crossed boundary first
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[1]!.id }, f.principal)
        const entered = rowsOf<{ kind: string }>(
          yield* runSql(sql`
            select kind from phase_events where phase_id = ${plan[0]!.id} and kind = 'entered'`),
        )
        const actual = one<{ at: number }>(
          yield* runSql(sql`
            select (extract(epoch from actual_entry_at) * 1000)::float8 as at
            from batch_phases where id = ${plan[0]!.id}`),
        )
        const again = yield* Effect.exit(
          assessment.advancePhase(f.tenant, batch.id, { to: plan[1]!.id }, f.principal),
        )
        return { before, after, entered, actual, planned, again }
      }),
    )
    const { before, after, entered, actual, planned, again } = ok(exit)
    expect(before).toEqual({ allowed: false, reason: 'no-active-phase' })
    expect(after).toEqual({ allowed: true })
    expect(entered).toHaveLength(1)
    // the semantic instant is the planned one, not when anybody got there
    expect(actual.at).toBe(planned)
    expect(tagOf(again)).toBe('ASSESSMENT_ADVANCE_INVALID')
  })

  it('narrows a scoped supplementary phase by item and participant over real rows', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('scoped')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Scoped',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.gradeA], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              phase({
                phaseKey: 'supplementary',
                permissionProfile: [
                  'assessment.entry.create',
                  'assessment.entry.submit',
                  'assessment.entry.resubmit',
                  'assessment.review.process',
                ],
              }),
              phase({ phaseKey: 'archive' }),
            ],
          },
          f.principal,
        )
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)

        // the roster rows are inputs here, read only; the allowance itself is
        // written through the service, the way the phase editor will
        const participants = rowsOf<{ id: string; user_id: string }>(
          yield* runSql(
            sql`select id, user_id from batch_participants where batch_id = ${batch.id}`,
          ),
        )
        const p1 = participants.find((row) => row.user_id === f.s1)!.id
        const p2 = participants.find((row) => row.user_id === f.s2)!.id
        const itemA = randomUUID()
        const stranger = yield* Effect.exit(
          assessment.replacePlan(
            f.tenant,
            batch.id,
            {
              specs: plan.map((row) =>
                row.phaseKey === 'supplementary'
                  ? { ...toSpec(row), participantScope: [randomUUID()] }
                  : toSpec(row),
              ),
            },
            f.principal,
          ),
        )
        const scoped = yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: plan.map((row) =>
              row.phaseKey === 'supplementary'
                ? { ...toSpec(row), itemScope: [itemA], participantScope: [p1] }
                : toSpec(row),
            ),
          },
          f.principal,
        )

        const gate = (code: string, ctx?: { itemId?: string; participantId?: string }) =>
          assessment.gate(f.tenant, batch.id, code, ctx)
        return {
          stranger,
          scoped,
          inScope: yield* gate('assessment.entry.create', { itemId: itemA, participantId: p1 }),
          wrongItem: yield* gate('assessment.entry.create', {
            itemId: randomUUID(),
            participantId: p1,
          }),
          wrongParticipant: yield* gate('assessment.entry.submit', {
            itemId: itemA,
            participantId: p2,
          }),
          resubmitCrossItem: yield* gate('assessment.entry.resubmit', { participantId: p1 }),
          resubmitBlocked: yield* gate('assessment.entry.resubmit', { participantId: p2 }),
          review: yield* gate('assessment.review.process'),
          itemA,
          p1,
        }
      }),
    )
    const decisions = ok(exit)
    // an allowance naming a stranger's row is refused before anything writes
    expect(tagOf(decisions.stranger)).toBe('ASSESSMENT_PLAN_INVALID')
    const supplementary = decisions.scoped.phases.find((row) => row.phaseKey === 'supplementary')!
    expect(supplementary.itemScope).toEqual([decisions.itemA])
    expect(supplementary.participantScope).toEqual([decisions.p1])
    expect(decisions.inScope).toEqual({ allowed: true })
    expect(decisions.wrongItem).toEqual({ allowed: false, reason: 'item-out-of-scope' })
    expect(decisions.wrongParticipant).toEqual({
      allowed: false,
      reason: 'participant-out-of-scope',
    })
    // resubmit is item-agnostic but participant-bound; review is untouched
    expect(decisions.resubmitCrossItem).toEqual({ allowed: true })
    expect(decisions.resubmitBlocked).toEqual({
      allowed: false,
      reason: 'participant-out-of-scope',
    })
    expect(decisions.review).toEqual({ allowed: true })
  })

  it('activates a plan that has no times yet, and shows nobody a batch that has not begun', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('stale')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Stale',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          { specs: [phase({ phaseKey: 'entry' })] },
          f.principal,
        )
        // structure is enough to commit: when it begins is decided after
        yield* startBatch(f.tenant, batch.id, f.principal)
        return yield* assessment.getBatch(f.tenant, batch.id, f.principal)
      }),
    )
    const activated = ok(exit)
    expect(activated.status).toBe('active')
    // nothing is running, so the batch has not begun for anyone
    expect(activated.currentPhaseId).toBeNull()
  })

  it('composes rbac, the gate and the policy slot in the authorize facade', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('facade')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Facade',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.gradeA], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              phase({ phaseKey: 'entry', permissionProfile: ['assessment.entry.submit'] }),
              phase({ phaseKey: 'archive' }),
            ],
          },
          f.principal,
        )
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)

        // A participant needs no grant of any kind: what makes them one is the
        // roster, drawn when the batch was created. Somebody outside the units
        // this batch faces is on nobody's roster and can do nothing here,
        // whatever the tenant thinks of them in general.
        const holder: Principal = { tenantId: f.tenant, userId: f.s1, sessionId: 's' }
        const stranger: Principal = { tenantId: f.tenant, userId: f.s3, sessionId: 's' }
        return {
          allowed: yield* assessment.authorizeEntryAction(
            holder,
            'assessment.entry.submit',
            batch.id,
          ),
          gateClosed: yield* assessment.authorizeEntryAction(
            holder,
            'assessment.entry.create',
            batch.id,
          ),
          notHeld: yield* assessment.authorizeEntryAction(
            stranger,
            'assessment.entry.submit',
            batch.id,
          ),
        }
      }),
    )
    const decisions = ok(exit)
    expect(decisions.allowed).toEqual({ allowed: true })
    expect(decisions.gateClosed).toEqual({
      allowed: false,
      layer: 'gate',
      reason: 'phase-closed',
    })
    expect(decisions.notHeld).toEqual({
      allowed: false,
      layer: 'rbac',
      reason: 'permission-not-held',
    })
  })

  it('logs one config event per save with the diff and bumps the counter', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('config')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Config',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        // a draft changes with zero ceremony: no counter, no event
        const drafted = yield* assessment.updateBatch(
          f.tenant,
          batch.id,
          { name: 'Renamed', reason: 'still drafting' },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              phase({ phaseKey: 'entry', permissionProfile: ['assessment.entry.submit'] }),
              phase({ phaseKey: 'archive' }),
            ],
          },
          f.principal,
        )
        yield* startBatch(f.tenant, batch.id, f.principal)

        // running: an actual change is one event and one counter move
        const changed = yield* assessment.updateBatch(
          f.tenant,
          batch.id,
          { name: 'Renamed again', reason: 'college asked' },
          f.principal,
        )
        // a no-op save moves nothing
        const noop = yield* assessment.updateBatch(
          f.tenant,
          batch.id,
          { name: 'Renamed again' },
          f.principal,
        )
        // and a plan change on an active batch is a config change too
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: plan.map((row) =>
              row.phaseKey === 'entry'
                ? { ...toSpec(row), permissionProfile: ['assessment.entry.create'] }
                : toSpec(row),
            ),
          },
          f.principal,
        )
        const events = rowsOf<{
          revision: number
          reason: string | null
          diff: Record<string, unknown>
        }>(
          yield* runSql(sql`
            select revision, reason, diff from batch_config_revisions
            where batch_id = ${batch.id} order by revision`),
        )
        const finished = yield* assessment.getBatch(f.tenant, batch.id, f.principal)
        return { drafted, changed, noop, events, finished }
      }),
    )
    const { drafted, changed, noop, events, finished } = ok(exit)
    expect(drafted.configRevision).toBe(0)
    expect(changed.configRevision).toBe(1)
    expect(noop.configRevision).toBe(1)
    expect(finished.configRevision).toBe(2)
    expect(events).toHaveLength(2)
    expect(events[0]!.reason).toBe('college asked')
    expect(Object.keys(events[0]!.diff)).toEqual(['name'])
    expect(Object.keys(events[1]!.diff)).toEqual(['phasePlan'])
  })

  it('holds templates to their structural rules and versions their edits', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('templates')
        const assessment = yield* Assessment
        const created = yield* assessment.createTemplate(
          f.tenant,
          {
            name: 'default',
            phases: [phase({ phaseKey: 'entry' }), phase({ phaseKey: 'archive' })],
          },
          f.principal,
        )
        const duplicate = yield* Effect.exit(
          assessment.createTemplate(f.tenant, { name: 'default', phases: [] }, f.principal),
        )
        // a template names business states, so a phase still needs a name
        const runaway = yield* Effect.exit(
          assessment.createTemplate(
            f.tenant,
            { name: 'runaway', phases: [phase({ phaseKey: 'entry', displayName: '  ' })] },
            f.principal,
          ),
        )
        // a tenant-level template cannot carry batch-local allowances
        const scoped = yield* Effect.exit(
          assessment.createTemplate(
            f.tenant,
            {
              name: 'scoped',
              phases: [
                phase({ phaseKey: 'entry', itemScope: [randomUUID()] }),
                phase({ phaseKey: 'archive' }),
              ],
            },
            f.principal,
          ),
        )
        const versioned = yield* assessment.updateTemplate(
          f.tenant,
          created.id,
          { phases: [phase({ phaseKey: 'archive' })] },
          f.principal,
        )
        return { created, duplicate, runaway, scoped, versioned }
      }),
    )
    const { created, duplicate, runaway, scoped, versioned } = ok(exit)
    expect(created.version).toBe(1)
    expect(tagOf(duplicate)).toBe('ASSESSMENT_TEMPLATE_CONFLICT')
    expect(tagOf(runaway)).toBe('ASSESSMENT_PLAN_INVALID')
    expect(tagOf(scoped)).toBe('ASSESSMENT_PLAN_INVALID')
    expect(versioned.version).toBe(2)
  })

  it('keeps timeline and phase templates apart', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('template-kinds')
        const assessment = yield* Assessment
        // a phase template is one phase's options: a name and a profile, no
        // times, no trigger of its own (manual by convention)
        const profile = yield* assessment.createTemplate(
          f.tenant,
          {
            name: 'entry defaults',
            kind: 'phase',
            phases: [phase({ phaseKey: 'entry', permissionProfile: ['assessment.entry.submit'] })],
          },
          f.principal,
        )
        const timed = yield* Effect.exit(
          assessment.createTemplate(
            f.tenant,
            {
              name: 'timed phase',
              kind: 'phase',
              phases: [
                phase({
                  phaseKey: 'entry',
                }),
                phase({ phaseKey: 'archive' }),
              ],
            },
            f.principal,
          ),
        )
        const timeline = yield* assessment.createTemplate(
          f.tenant,
          { name: 'whole plan', phases: [phase({ phaseKey: 'archive' })] },
          f.principal,
        )
        // the timeline picker must not see phase templates, and vice versa
        const timelines = yield* assessment.listTemplates(
          f.tenant,
          { kind: 'timeline', limit: 10 },
          f.principal,
        )
        const profiles = yield* assessment.listTemplates(
          f.tenant,
          { kind: 'phase', limit: 10 },
          f.principal,
        )
        // a phase template is not a plan, so it cannot replace one
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'kinds',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.class1], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        const misapplied = yield* Effect.exit(
          assessment.replacePlan(f.tenant, batch.id, { fromTemplateId: profile.id }, f.principal),
        )
        // the list search matches a name substring, pushed into the query
        yield* assessment.createBatch(
          f.tenant,
          {
            name: 'unrelated spring round',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.class3], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        const searched = yield* assessment.listBatches(
          f.tenant,
          { q: 'kind', limit: 10 },
          f.principal,
        )
        // the count answers the same filter as the page, which is what makes
        // "page 2 of 5" true rather than decorative
        const searchedTotal = yield* assessment.countBatches(f.tenant, { q: 'kind' }, f.principal)
        const allTotal = yield* assessment.countBatches(f.tenant, {}, f.principal)
        return {
          profile,
          timed,
          timelines,
          profiles,
          misapplied,
          searched,
          searchedTotal,
          allTotal,
        }
      }),
    )
    const { profile, timed, timelines, profiles, misapplied, searched, searchedTotal, allTotal } =
      ok(exit)
    expect(profile.kind).toBe('phase')
    const timedReasons = reasonsOf(timed).flatMap(
      (entry) =>
        (entry.error as { refusals?: readonly { reason: string }[] } | undefined)?.refusals ?? [],
    )
    expect(timedReasons.map((entry) => entry.reason)).toContain('phase-template-shape')
    expect(timelines.map((row) => row.name)).toEqual(['whole plan'])
    expect(profiles.map((row) => row.name)).toEqual(['entry defaults'])
    const misappliedReasons = reasonsOf(misapplied).flatMap(
      (entry) =>
        (entry.error as { refusals?: readonly { reason: string }[] } | undefined)?.refusals ?? [],
    )
    expect(misappliedReasons.map((entry) => entry.reason)).toContain('template-not-a-timeline')
    expect(searched.map((row) => row.name)).toEqual(['kinds'])
    expect(searchedTotal).toBe(1)
    expect(allTotal).toBe(2)
  })
})
