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
  entryTrigger: 'manual',
  permissionProfile: [],
  ...over,
})

const toSpec = (row: PhaseRow): PhaseSpecInput => ({
  id: row.id,
  phaseKey: row.phaseKey,
  displayName: row.displayName,
  entryTrigger: row.entryTrigger,
  plannedEntryAt: row.plannedEntryAt,
  entryOffset: row.entryOffset,
  estimatedEntryAt: row.estimatedEntryAt,
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
            scopeNodeId: f.gradeA,
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            userTypeIds: [f.studentType],
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
                entryTrigger: 'scheduled',
                plannedEntryAt: Date.now() + HOUR,
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
        const activated = yield* assessment.setBatchStatus(
          f.tenant,
          batch.id,
          'active',
          f.principal,
        )
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
    // enrolled students in scope only: the other grade, the teacher and the
    // disabled account stay out
    expect(roster.map((row) => row.user_id).sort()).toEqual([f.s1, f.s2].sort())
    const s1Row = roster.find((row) => row.user_id === f.s1)!
    expect(s1Row.anchor_lineage).toEqual([
      { nodeId: f.class1, nodeTypeId: f.classType },
      { nodeId: f.gradeA, nodeTypeId: f.gradeType },
      { nodeId: f.root, nodeTypeId: f.collegeType },
    ])
  })

  it('refuses to activate a batch that can enroll nobody', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('nobody')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Empty',
            scopeNodeId: f.root,
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            userTypeIds: [],
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          { specs: [phase({ phaseKey: 'archive' })] },
          f.principal,
        )
        return yield* assessment.setBatchStatus(f.tenant, batch.id, 'active', f.principal)
      }),
    )
    expect(tagOf(exit)).toBe('ASSESSMENT_BATCH_NO_USER_TYPES')
  })

  it('edits a future plan with an audit trail and locks entered history', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('edits')
        const assessment = yield* Assessment
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Edits',
            scopeNodeId: f.root,
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            userTypeIds: [f.studentType],
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              phase({ phaseKey: 'entry', permissionProfile: ['assessment.entry.submit'] }),
              // beyond a manual boundary a hard plan is forbidden; the offset
              // becomes a plan when the boundary fires
              phase({ phaseKey: 'review', entryTrigger: 'scheduled', entryOffset: { hours: 2 } }),
              phase({ phaseKey: 'archive' }),
            ],
          },
          f.principal,
        )
        yield* assessment.setBatchStatus(f.tenant, batch.id, 'active', f.principal)
        let plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)
        plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        // advancing determined the anchor: the offset materialized, audited
        const materialized = rowsOf<{ kind: string }>(
          yield* runSql(sql`
            select kind from phase_events
            where phase_id = ${plan[1]!.id} and kind = 'offset-materialized'`),
        )
        if (plan[1]!.plannedEntryAt === null) return yield* Effect.die('offset did not materialize')

        // a future boundary moves, and the move is audited
        const moved = Date.now() + 3 * HOUR
        const specs = plan.map(toSpec)
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          { specs: specs.map((s) => (s.id === plan[1]!.id ? { ...s, plannedEntryAt: moved } : s)) },
          f.principal,
        )
        const audited = rowsOf<{ kind: string }>(
          yield* runSql(sql`
            select kind from phase_events where phase_id = ${plan[1]!.id} and kind = 'planned-changed'`),
        )

        // the entered phase's time fields are history
        const refused = yield* Effect.exit(
          assessment.replacePlan(
            f.tenant,
            batch.id,
            {
              specs: specs.map((s) =>
                s.id === plan[0]!.id ? { ...s, plannedEntryAt: Date.now() + HOUR } : s,
              ),
            },
            f.principal,
          ),
        )
        return { audited, refused, materialized }
      }),
    )
    const { audited, refused, materialized } = ok(exit)
    expect(materialized).toHaveLength(1)
    expect(audited).toHaveLength(1)
    expect(tagOf(refused)).toBe('ASSESSMENT_PLAN_INVALID')
    const refusal = reasonsOf(refused)
      .flatMap(
        (entry) =>
          (entry.error as { refusals?: readonly { reason: string }[] } | undefined)?.refusals ?? [],
      )
      .map((entry) => entry.reason)
    expect(refusal).toContain('phase-already-entered')
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
            scopeNodeId: f.root,
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            userTypeIds: [f.studentType],
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              phase({ phaseKey: 'entry' }),
              phase({ phaseKey: 'review', entryTrigger: 'scheduled', entryOffset: { hours: 2 } }),
              phase({ phaseKey: 'archive' }),
            ],
          },
          f.principal,
        )
        yield* assessment.setBatchStatus(f.tenant, batch.id, 'active', f.principal)
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)

        const wrongTarget = yield* Effect.exit(
          assessment.advancePhase(f.tenant, batch.id, { to: plan[2]!.id }, f.principal),
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
          'archived',
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
            scopeNodeId: f.root,
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            userTypeIds: [f.studentType],
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
                entryTrigger: 'scheduled',
                plannedEntryAt: planned,
                permissionProfile: ['assessment.entry.submit'],
              }),
              phase({ phaseKey: 'archive', permissionProfile: ['assessment.review.process'] }),
            ],
          },
          f.principal,
        )
        yield* assessment.setBatchStatus(f.tenant, batch.id, 'active', f.principal)
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)

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
            scopeNodeId: f.gradeA,
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            userTypeIds: [f.studentType],
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
        yield* assessment.setBatchStatus(f.tenant, batch.id, 'active', f.principal)
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)

        const participants = rowsOf<{ id: string; user_id: string }>(
          yield* runSql(
            sql`select id, user_id from batch_participants where batch_id = ${batch.id}`,
          ),
        )
        const p1 = participants.find((row) => row.user_id === f.s1)!.id
        const p2 = participants.find((row) => row.user_id === f.s2)!.id
        const itemA = randomUUID()
        yield* runSql(sql`
          insert into phase_item_scopes (tenant_id, phase_id, item_id)
          values (${f.tenant}, ${plan[0]!.id}, ${itemA})`)
        yield* runSql(sql`
          insert into phase_participant_scopes (tenant_id, phase_id, participant_id)
          values (${f.tenant}, ${plan[0]!.id}, ${p1})`)

        const gate = (code: string, ctx?: { itemId?: string; participantId?: string }) =>
          assessment.gate(f.tenant, batch.id, code, ctx)
        return {
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
        }
      }),
    )
    const decisions = ok(exit)
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
            scopeNodeId: f.gradeA,
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            userTypeIds: [f.studentType],
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
        yield* assessment.setBatchStatus(f.tenant, batch.id, 'active', f.principal)
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)

        // one student holds submit and create through a role; the other holds nothing
        const role = one<{ id: string }>(
          yield* runSql(sql`
            insert into roles (tenant_id, code, name, kind, status, permission_mode)
            values (${f.tenant}, 'student', 'Student', 'tenant', 'active', 'explicit') returning id`),
        ).id
        for (const code of ['assessment.entry.submit', 'assessment.entry.create']) {
          const permission = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values (${code}, 'assessment', ${code}, 'tenant')
              on conflict (code) do update set code = excluded.code returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${role}, ${permission})`)
        }
        yield* runSql(sql`
          insert into role_grants (tenant_id, user_id, role_id)
          values (${f.tenant}, ${f.s1}, ${role})`)

        const holder: Principal = { tenantId: f.tenant, userId: f.s1, sessionId: 's' }
        const stranger: Principal = { tenantId: f.tenant, userId: f.s2, sessionId: 's' }
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
            scopeNodeId: f.root,
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            userTypeIds: [],
          },
          f.principal,
        )
        const updated = yield* assessment.updateBatch(
          f.tenant,
          batch.id,
          { name: 'Renamed', userTypeIds: [f.studentType], reason: 'scope settled' },
          f.principal,
        )
        const event = one<{ revision: number; reason: string; diff: Record<string, unknown> }>(
          yield* runSql(sql`
            select revision, reason, diff from batch_config_revisions where batch_id = ${batch.id}`),
        )
        return { updated, event }
      }),
    )
    const { updated, event } = ok(exit)
    expect(updated.configRevision).toBe(1)
    expect(updated.name).toBe('Renamed')
    expect(event.revision).toBe(1)
    expect(event.reason).toBe('scope settled')
    expect(Object.keys(event.diff).sort()).toEqual(['name', 'userTypeIds'])
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
        const runaway = yield* Effect.exit(
          assessment.createTemplate(
            f.tenant,
            {
              name: 'runaway',
              phases: [
                phase({
                  phaseKey: 'entry',
                  entryTrigger: 'scheduled',
                  plannedEntryAt: Date.now() + HOUR,
                }),
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
        return { created, duplicate, runaway, versioned }
      }),
    )
    const { created, duplicate, runaway, versioned } = ok(exit)
    expect(created.version).toBe(1)
    expect(tagOf(duplicate)).toBe('ASSESSMENT_TEMPLATE_CONFLICT')
    expect(tagOf(runaway)).toBe('ASSESSMENT_PLAN_INVALID')
    expect(versioned.version).toBe(2)
  })
})
