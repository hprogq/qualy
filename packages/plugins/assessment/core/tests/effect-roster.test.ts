import { inspect } from 'node:util'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

// The roster's management face: the diff is a derived view computed on read,
// the roster never moves on its own, and every change is a person's explicit
// action. These are acceptance item ⑤ - the four drift classes plus the
// scope-integrity warning, symmetric transfer in both directions, exclusion
// that deletes nothing, and inclusion that warns about double participation.

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

const reasonsOf = (exit: Exit.Exit<unknown, unknown>): readonly { error?: unknown }[] =>
  Exit.isFailure(exit)
    ? ((exit.cause as { reasons?: readonly { error?: unknown }[] }).reasons ?? [])
    : []

const tagOf = (exit: Exit.Exit<unknown, unknown>): string | undefined =>
  reasonsOf(exit)
    .map((entry) => (entry.error as { _tag?: string } | undefined)?._tag)
    .find((tag) => tag !== undefined)

const reasonIn = (exit: Exit.Exit<unknown, unknown>): string | undefined =>
  reasonsOf(exit)
    .map((entry) => (entry.error as { reason?: string } | undefined)?.reason)
    .find((reason) => reason !== undefined)

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows

const phase = (over: Partial<PhaseSpecInput> & { phaseKey: string }): PhaseSpecInput => ({
  displayName: over.phaseKey,
  entryTrigger: 'manual',
  permissionProfile: [],
  ...over,
})

/** a college of two grades, three classes, and everyone the diff classes need */
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
    const s4 = yield* person('S4', studentType, class1)
    const t1 = yield* person('T1', teacherType, class1)
    const gone = yield* person('Gone', studentType, class1, false)

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

    const moveUser = (userId: string, nodeId: string) =>
      Effect.asVoid(
        runSql(sql`update users set primary_org_node_id = ${nodeId} where id = ${userId}`),
      )
    const setUserType = (userId: string, typeId: string) =>
      Effect.asVoid(runSql(sql`update users set user_type_id = ${typeId} where id = ${userId}`))
    /** an org role held at exactly one node, for the chain preview to count */
    const grantRoleAt = (userId: string, nodeId: string, code: string) =>
      Effect.gen(function* () {
        const role = one<{ id: string }>(
          yield* runSql(sql`
            insert into roles (tenant_id, code, name, kind, status, permission_mode)
            values (${tenant}, ${code}, ${code}, 'org', 'active', 'explicit') returning id`),
        ).id
        yield* runSql(sql`
          insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
          values (${tenant}, ${userId}, ${role}, ${nodeId}, 'self')`)
      })

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
      s4,
      t1,
      gone,
      principal,
      moveUser,
      setUserType,
      grantRoleAt,
      node,
    }
  })

type Seeded = ReturnType<typeof seed> extends Effect.Effect<infer A, infer _E, infer _R> ? A : never

const activateBatch = (
  f: Seeded,
  name: string,
  scopeNodeIds: readonly string[],
  anchorAutoSync?: boolean,
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const batch = yield* assessment.createBatch(
      f.tenant,
      {
        name,
        scopeNodeIds,
        materialRange: { start: '2026-03-01', end: '2026-09-01' },
        userTypeIds: [f.studentType],
        ...(anchorAutoSync !== undefined ? { anchorAutoSync } : {}),
      },
      f.principal,
    )
    yield* assessment.replacePlan(
      f.tenant,
      batch.id,
      { specs: [phase({ phaseKey: 'archive' })] },
      f.principal,
    )
    yield* assessment.setBatchStatus(f.tenant, batch.id, 'active', f.principal)
    return batch
  })

describe.runIf(postgresAvailable).concurrent('the roster management face', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-roster')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('derives every diff class on read, symmetrically, without moving the roster', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('diff')
        const assessment = yield* Assessment
        // a scope of grade A plus one empty leaf that will be deleted
        const leaf = yield* f.node(f.gradeType, f.root, 'Doomed', 'r.x', 1)
        const batchA = yield* activateBatch(f, 'Batch A', [f.gradeA, leaf])
        const batchB = yield* activateBatch(f, 'Batch B', [f.gradeB])

        const frozenBefore = rowsOf<{ user_id: string; anchor_path: string }>(
          yield* runSql(sql`
            select user_id, anchor_path::text as anchor_path from batch_participants
            where batch_id = ${batchA.id} order by anchor_path, user_id`),
        )

        // the semester happens: a transfer in, a transfer out, a class move,
        // a type change, and a scope unit deleted outright
        yield* f.moveUser(f.s3, f.class1)
        yield* f.moveUser(f.s2, f.class3)
        yield* f.moveUser(f.s4, f.class2)
        yield* f.setUserType(f.s1, f.teacherType)
        yield* runSql(sql`delete from org_nodes where id = ${leaf}`)

        const diffA = yield* assessment.rosterDiff(f.tenant, batchA.id, f.principal)
        const diffB = yield* assessment.rosterDiff(f.tenant, batchB.id, f.principal)
        const frozenAfter = rowsOf<{ user_id: string; anchor_path: string }>(
          yield* runSql(sql`
            select user_id, anchor_path::text as anchor_path from batch_participants
            where batch_id = ${batchA.id} order by anchor_path, user_id`),
        )
        const roster = yield* assessment.listParticipants(
          f.tenant,
          batchA.id,
          { limit: 10 },
          f.principal,
        )
        return { diffA, diffB, frozenBefore, frozenAfter, roster, f, batchA, batchB }
      }),
    )
    const { diffA, diffB, frozenBefore, frozenAfter, roster, f, batchA, batchB } = ok(exit)

    // batch A: s3 arrived (already active in B, and the panel says so)
    expect(diffA.newArrivals.map((row) => row.userId)).toEqual([f.s3])
    expect(diffA.newArrivals[0]!.activeElsewhere).toEqual([{ batchId: batchB.id, name: 'Batch B' }])
    // s2 left the scope, s4 moved inside it, s1 changed what they are
    expect(diffA.departed.map((row) => row.userId)).toEqual([f.s2])
    expect(diffA.anchorChanged.map((row) => row.userId)).toEqual([f.s4])
    expect(diffA.anchorChanged[0]!.to).toEqual({ nodeId: f.class2, path: 'r.a.c2' })
    expect(diffA.userTypeChanged.map((row) => row.userId)).toEqual([f.s1])
    expect(diffA.userTypeChanged[0]!.toEnrolled).toBe(false)
    // the definition itself has a hole where the deleted unit was
    expect(diffA.scopeIntegrity).toEqual([{ nodeId: expect.any(String) }])

    // and the same semester, seen from batch B: symmetric
    expect(diffB.newArrivals.map((row) => row.userId)).toEqual([f.s2])
    expect(diffB.newArrivals[0]!.activeElsewhere).toEqual([{ batchId: batchA.id, name: 'Batch A' }])
    expect(diffB.departed.map((row) => row.userId)).toEqual([f.s3])

    // nothing on the roster moved: arrivals are not added, the frozen
    // snapshot ignores the whole commotion
    expect(frozenAfter).toEqual(frozenBefore)
    expect(roster.map((row) => row.userId).sort()).toEqual([f.s1, f.s2, f.s4].sort())
    expect(roster[0]!.displayName).toBeTruthy()
  })

  it('includes explicitly, warns about double participation, previews the chain', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('include')
        const assessment = yield* Assessment
        const batchA = yield* activateBatch(f, 'Batch A', [f.gradeA])
        const batchB = yield* activateBatch(f, 'Batch B', [f.gradeB])
        yield* f.grantRoleAt(f.t1, f.class1, 'class-monitor')

        // the refusals, before anyone moves: a teacher, a disabled account,
        // an eligible student who simply stands outside the scope, a
        // stranger, and a batch with no roster yet
        const teacher = yield* Effect.exit(
          assessment.includeParticipant(f.tenant, batchA.id, f.t1, f.principal),
        )
        const disabled = yield* Effect.exit(
          assessment.includeParticipant(f.tenant, batchA.id, f.gone, f.principal),
        )
        const outside = yield* Effect.exit(
          assessment.includeParticipant(f.tenant, batchA.id, f.s3, f.principal),
        )
        const stranger = yield* Effect.exit(
          assessment.includeParticipant(f.tenant, batchA.id, randomUUID(), f.principal),
        )
        const draft = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Draft',
            scopeNodeIds: [f.gradeA],
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            userTypeIds: [f.studentType],
          },
          f.principal,
        )
        const notActive = yield* Effect.exit(
          assessment.includeParticipant(f.tenant, draft.id, f.s1, f.principal),
        )

        // the transfer student arrives and is included, eyes open
        yield* f.moveUser(f.s3, f.class1)
        const included = yield* assessment.includeParticipant(
          f.tenant,
          batchA.id,
          f.s3,
          f.principal,
        )
        const again = yield* Effect.exit(
          assessment.includeParticipant(f.tenant, batchA.id, f.s3, f.principal),
        )
        return { teacher, disabled, outside, stranger, notActive, included, again, f, batchB }
      }),
    )
    const { teacher, disabled, outside, stranger, notActive, included, again, f, batchB } = ok(exit)

    expect(reasonIn(teacher)).toBe('user-not-eligible')
    expect(reasonIn(disabled)).toBe('user-not-eligible')
    expect(reasonIn(outside)).toBe('user-out-of-scope')
    expect(reasonIn(stranger)).toBe('user-not-found')
    expect(reasonIn(notActive)).toBe('batch-not-active')

    // frozen where they stand now, with the full lineage
    expect(included.participant.anchorNodeId).toBe(f.class1)
    expect(included.participant.anchorLineage).toEqual([
      { nodeId: f.class1, nodeTypeId: f.classType },
      { nodeId: f.gradeA, nodeTypeId: f.gradeType },
      { nodeId: f.root, nodeTypeId: f.collegeType },
    ])
    // the decision aids: still active over in batch B, and the class level
    // has exactly one person who could review anything
    expect(included.activeElsewhere).toEqual([{ batchId: batchB.id, name: 'Batch B' }])
    expect(included.chainPreview).toEqual([
      { nodeId: f.class1, nodeTypeId: f.classType, holders: 1 },
      { nodeId: f.gradeA, nodeTypeId: f.gradeType, holders: 0 },
      { nodeId: f.root, nodeTypeId: f.collegeType, holders: 0 },
    ])
    expect(reasonIn(again)).toBe('already-included')
  })

  it('excludes without deleting, and re-includes through the same door', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('exclude')
        const assessment = yield* Assessment
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        const participants = yield* assessment.listParticipants(
          f.tenant,
          batch.id,
          { limit: 10 },
          f.principal,
        )
        const p2 = participants.find((row) => row.userId === f.s2)!

        yield* f.moveUser(f.s2, f.class3)
        const before = yield* assessment.rosterDiff(f.tenant, batch.id, f.principal)
        const excluded = yield* assessment.setParticipantStatus(
          f.tenant,
          batch.id,
          p2.id,
          'excluded',
          f.principal,
        )
        const twice = yield* assessment.setParticipantStatus(
          f.tenant,
          batch.id,
          p2.id,
          'excluded',
          f.principal,
        )
        const after = yield* assessment.rosterDiff(f.tenant, batch.id, f.principal)
        const count = one<{ count: number }>(
          yield* runSql(sql`
            select count(*)::int as count from batch_participants where batch_id = ${batch.id}`),
        )
        const restored = yield* assessment.setParticipantStatus(
          f.tenant,
          batch.id,
          p2.id,
          'active',
          f.principal,
        )
        return { before, excluded, twice, after, count, restored, f }
      }),
    )
    const { before, excluded, twice, after, count, restored, f } = ok(exit)

    expect(before.departed.map((row) => row.userId)).toEqual([f.s2])
    expect(excluded.status).toBe('excluded')
    expect(excluded.excludedAt).not.toBeNull()
    // saying it twice converges; the row and its history remain
    expect(twice.status).toBe('excluded')
    expect(count.count).toBe(3)
    // an excluded row is a decision made: the diff stops nagging about it
    expect(after.departed).toEqual([])
    expect(restored.status).toBe('active')
    expect(restored.excludedAt).toBeNull()
  })

  it('applies an anchor change by refreezing the whole snapshot', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('anchor')
        const assessment = yield* Assessment
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        yield* f.grantRoleAt(f.t1, f.class2, 'class-monitor')
        const participants = yield* assessment.listParticipants(
          f.tenant,
          batch.id,
          { limit: 10 },
          f.principal,
        )
        const p4 = participants.find((row) => row.userId === f.s4)!
        const p1 = participants.find((row) => row.userId === f.s1)!
        const p2 = participants.find((row) => row.userId === f.s2)!

        yield* f.moveUser(f.s4, f.class2)
        const applied = yield* assessment.applyParticipantAnchor(
          f.tenant,
          batch.id,
          p4.id,
          f.principal,
        )
        const settled = yield* assessment.rosterDiff(f.tenant, batch.id, f.principal)

        // an excluded participant has no anchor to manage, and a participant
        // who left the scope needs exclusion, not an anchor outside it
        yield* assessment.setParticipantStatus(f.tenant, batch.id, p1.id, 'excluded', f.principal)
        const onExcluded = yield* Effect.exit(
          assessment.applyParticipantAnchor(f.tenant, batch.id, p1.id, f.principal),
        )
        yield* f.moveUser(f.s2, f.class3)
        const outOfScope = yield* Effect.exit(
          assessment.applyParticipantAnchor(f.tenant, batch.id, p2.id, f.principal),
        )
        return { applied, settled, onExcluded, outOfScope, f }
      }),
    )
    const { applied, settled, onExcluded, outOfScope, f } = ok(exit)

    expect(applied.participant.anchorNodeId).toBe(f.class2)
    expect(applied.participant.anchorPath).toBe('r.a.c2')
    expect(applied.participant.anchorLineage[0]).toEqual({
      nodeId: f.class2,
      nodeTypeId: f.classType,
    })
    expect(applied.chainPreview[0]).toEqual({
      nodeId: f.class2,
      nodeTypeId: f.classType,
      holders: 1,
    })
    // applied means the drift is gone
    expect(settled.anchorChanged).toEqual([])
    expect(reasonIn(onExcluded)).toBe('participant-not-active')
    expect(reasonIn(outOfScope)).toBe('user-out-of-scope')
  })

  it('carries the anchor auto-sync switch as configuration', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('sugar')
        const assessment = yield* Assessment
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA], true)
        const toggled = yield* assessment.updateBatch(
          f.tenant,
          batch.id,
          { anchorAutoSync: false, reason: 'panel only for now' },
          f.principal,
        )
        const event = one<{ diff: Record<string, unknown> }>(
          yield* runSql(sql`
            select diff from batch_config_revisions where batch_id = ${batch.id}
            order by revision desc limit 1`),
        )
        return { batch, toggled, event }
      }),
    )
    const { batch, toggled, event } = ok(exit)
    expect(batch.anchorAutoSync).toBe(true)
    expect(toggled.anchorAutoSync).toBe(false)
    // a config change like any other: one event, the counter moved
    expect(Object.keys(event.diff)).toEqual(['anchorAutoSync'])
    expect(toggled.configRevision).toBe(1)
  })
})
