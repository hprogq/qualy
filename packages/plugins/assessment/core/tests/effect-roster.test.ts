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
import { assembledLayer } from '@qualy/api-kit/assembled'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { accessActions } from '@qualy/plugin-rbac/actions'
import { assessmentActions } from '../src/actions.ts'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { Rbac } from '@qualy/rbac-contract/effect'
import type { Orm } from '@qualy/plugin-database/server'
import { entities } from '../src/db/entities.ts'
import { permissions as assessmentPermissions } from '../src/permissions.ts'
import { catalogLayers, storageForTest } from './support/catalogs.ts'
import { startBatch } from './support/lifecycle.ts'
import { Assessment, serviceLayer, type PhaseSpecInput } from '../src/server/index.ts'

// The roster is the batch's only population.
//
// There is no participant scope to keep it in step with: the organization is
// where people are found, and every change to who takes part is somebody
// deciding to make it. So these are about the two ways in - by name, and by
// importing a query once - and about the way out, which deletes nothing.

const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  { owner: 'assessment', permissions: assessmentPermissions },
])

const closure = [
  ...orgEntities,
  ...authEntities,
  ...rbacEntities,
  ...entities,
  ...auditEntities,
] as const

const stack = (url: string) => {
  const services = booted(
    rbacLayer.pipe(
      // the writer the audited services record through, on the same database
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([
                { owner: 'rbac', actions: accessActions },
                { owner: 'assessment', actions: assessmentActions },
              ]),
            ),
          ),
        ),
      ),
      Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
    ),
    { catalog },
  )
  return serviceLayer.pipe(
    Layer.provideMerge(services),
    Layer.provide(catalogLayers),
    // one services value on purpose: the layer memo map shares it, so the
    // storage stack runs on the same database as everything else
    Layer.provide(storageForTest().pipe(Layer.provide(services))),
    // the boot-hook registry the service registers its backfill into
    Layer.provide(assembledLayer),
  )
}

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
          insert into org_types (tenant_id, name)
          values (${tenant}, ${code}) returning id`),
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
            insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${tenant}, ${code}, ${code}, 'org', 'active', 'explicit', 'allow-list') returning id`),
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

const activateBatch = (f: Seeded, name: string, orgNodeIds: readonly string[]) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const batch = yield* assessment.createBatch(
      f.tenant,
      {
        name,
        materialRange: { start: '2026-03-01', end: '2026-09-01' },
        import: { orgNodeIds, userTypeIds: [f.studentType] },
      },
      f.principal,
    )
    yield* assessment.replacePlan(
      f.tenant,
      batch.id,
      { specs: [phase({ phaseKey: 'archive' })] },
      f.principal,
    )
    yield* startBatch(f.tenant, batch.id, f.principal)
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

  it('imports a query once, and never again on its own', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('import')
        const assessment = yield* Assessment
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        const atCreation = yield* assessment.listParticipants(
          f.tenant,
          batch.id,
          { limit: 50 },
          f.principal,
        )

        // somebody joins the same units afterwards
        const late = one<{ id: string }>(
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.tenant}, 'Late', ${f.studentType}, ${f.class1}) returning id`),
        ).id
        const untouched = yield* assessment.listParticipants(
          f.tenant,
          batch.id,
          { limit: 50 },
          f.principal,
        )

        // and the same import run again offers exactly them
        const preview = yield* assessment.previewImport(
          f.tenant,
          batch.id,
          { orgNodeIds: [f.gradeA], userTypeIds: [f.studentType] },
          f.principal,
        )
        const imported = yield* assessment.importParticipants(
          f.tenant,
          batch.id,
          { orgNodeIds: [f.gradeA], userTypeIds: [f.studentType] },
          f.principal,
        )
        const after = yield* assessment.listParticipants(
          f.tenant,
          batch.id,
          { limit: 50 },
          f.principal,
        )
        const history = yield* assessment.listImports(f.tenant, batch.id, {}, f.principal)
        return { atCreation, untouched, preview, imported, after, history, late }
      }),
    )
    const { atCreation, untouched, preview, imported, after, history, late } = ok(exit)

    // creating the batch ran the query once
    expect(atCreation.length).toBeGreaterThan(0)
    // and nothing has moved since, though the organization has
    expect(untouched.map((row) => row.userId).sort()).toEqual(
      atCreation.map((row) => row.userId).sort(),
    )
    // running it again is a decision, and it offers only what is new
    expect(preview).toEqual({ candidates: 1 })
    expect(imported).toEqual({ added: 1 })
    expect(after.map((row) => row.userId)).toContain(late)
    // both runs are recorded as the acts they were, and the page says it
    // has reached the end rather than leaving the reader to guess
    expect(history.items.map((row) => row.importedCount)).toEqual([1, atCreation.length])
    expect(history.nextCursor).toBeNull()
  })

  it('imports only people the caller actually administers', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('reach')
        const assessment = yield* Assessment
        // a round nobody has been added to yet, so administering it asks only
        // for the permission and the question is purely about the import
        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Batch',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.gradeA], userTypeIds: [] },
          },
          f.principal,
        )

        // a coordinator who administers the grade itself but not the classes
        // under it: authority at a node is not authority over its subtree
        const coordinator = one<{ id: string }>(
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.tenant}, 'Coordinator', ${f.teacherType}, ${f.gradeA}) returning id`),
        ).id
        const role = one<{ id: string }>(
          yield* runSql(sql`
            insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${f.tenant}, 'coord', 'Coordinator', 'org', 'active', 'explicit', 'allow-list')
            returning id`),
        ).id
        const permission = one<{ id: string }>(
          yield* runSql(sql`select id from permissions where code = 'assessment.batch.manage'`),
        ).id
        yield* runSql(sql`insert into role_permissions (tenant_id, role_id, permission_id)
          values (${f.tenant}, ${role}, ${permission})`)
        yield* runSql(sql`
          insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
          values (${f.tenant}, ${coordinator}, ${role}, ${f.gradeA}, 'self')`)
        const asCoordinator: Principal = {
          tenantId: f.tenant,
          userId: coordinator,
          sessionId: 's',
        }

        // the students all stand in classes below the grade, so asking for the
        // grade must offer none of them
        const preview = yield* assessment.previewImport(
          f.tenant,
          batch.id,
          { orgNodeIds: [f.gradeA], userTypeIds: [f.studentType] },
          asCoordinator,
        )
        return { preview }
      }),
    )
    const { preview } = ok(exit)
    expect(preview).toEqual({ candidates: 0 })
  })

  it('adds people by name, skipping whoever is already taking part', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('by-name')
        const assessment = yield* Assessment
        // an empty round: nobody is imported, because nothing is asked for
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        const already = (yield* assessment.listParticipants(
          f.tenant,
          batch.id,
          { limit: 50 },
          f.principal,
        )).map((row) => row.userId)

        const added = yield* assessment.addParticipants(
          f.tenant,
          batch.id,
          [...already, f.s3],
          f.principal,
        )
        const stranger = yield* Effect.exit(
          assessment.addParticipants(f.tenant, batch.id, [randomUUID()], f.principal),
        )
        return { added, stranger, already }
      }),
    )
    const { added, stranger, already } = ok(exit)
    expect(added).toEqual({ added: 1, skipped: already.length })
    expect(reasonIn(stranger)).toBe('user-not-found')
  })

  it('lets somebody excluded be added again, on the row they already had', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('re-add')
        const assessment = yield* Assessment
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        const first = (yield* assessment.listParticipants(
          f.tenant,
          batch.id,
          { limit: 50 },
          f.principal,
        ))[0]!
        yield* assessment.setParticipantStatus(
          f.tenant,
          batch.id,
          first.id,
          'excluded',
          'left the class',
          f.principal,
        )
        // adding them again is not a second membership; it is this one, back
        const added = yield* assessment.addParticipants(
          f.tenant,
          batch.id,
          [first.userId],
          f.principal,
        )
        const rows = rowsOf<{ id: string; status: string; exclusion_reason: string | null }>(
          yield* runSql(sql`
            select id, status, exclusion_reason from batch_participants
            where batch_id = ${batch.id} and user_id = ${first.userId}`),
        )
        return { added, rows, first }
      }),
    )
    const { added, rows, first } = ok(exit)
    expect(added).toEqual({ added: 1, skipped: 0 })
    // one row, the same one, and the withdrawal cleared off it
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(first.id)
    expect(rows[0]!.status).toBe('active')
    expect(rows[0]!.exclusion_reason).toBeNull()
  })

  it('narrows the list to a unit, and says how far down to look', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('narrow')
        const assessment = yield* Assessment
        // the grade covers two classes; the students stand in the classes
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        const page = (orgNodeIds: readonly string[], orgScope?: 'self' | 'subtree') =>
          assessment.listParticipants(
            f.tenant,
            batch.id,
            { limit: 50, orgNodeIds, ...(orgScope !== undefined ? { orgScope } : {}) },
            f.principal,
          )
        const everywhere = yield* page([])
        const under = yield* page([f.gradeA], 'subtree')
        const atTheGrade = yield* page([f.gradeA], 'self')
        const inOneClass = yield* page([f.class1], 'self')
        return { everywhere, under, atTheGrade, inOneClass }
      }),
    )
    const { everywhere, under, atTheGrade, inOneClass } = ok(exit)
    expect(under.map((row) => row.userId).sort()).toEqual(
      everywhere.map((row) => row.userId).sort(),
    )
    // nobody is frozen at the grade itself, which is the point of the toggle
    expect(atTheGrade).toEqual([])
    expect(inOneClass.length).toBeGreaterThan(0)
    expect(inOneClass.length).toBeLessThan(under.length)
  })

  it('names the units this round was drawn from, whatever org does afterwards', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('units')
        const assessment = yield* Assessment
        // drawn from grade A, whose students stand in classes 1 and 2
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        const units = () => assessment.listRosterUnits(f.tenant, batch.id, {}, f.principal)
        const before = yield* units()
        // everybody in class 1 is moved to a class this round never drew from
        yield* f.moveUser(f.s1, f.class3)
        yield* f.moveUser(f.s4, f.class3)
        const afterMove = yield* units()
        // and class 1 is renamed
        yield* Effect.asVoid(
          runSql(sql`update org_nodes set name = 'Renamed' where id = ${f.class1}`),
        )
        const afterRename = yield* units()
        return { f, before, afterMove, afterRename }
      }),
    )
    const { f, before, afterMove, afterRename } = ok(exit)
    const idsOf = (units: readonly { id: string }[]) => units.map((unit) => unit.id).sort()

    // the round's own tree: the classes its people were frozen in, and every
    // unit above them - never a corner of the organization it did not reach
    expect(idsOf(before)).toEqual([f.root, f.gradeA, f.class1, f.class2].sort())
    expect(idsOf(before)).not.toContain(f.class3)

    // moving people out does not move the round. The tree is what this batch
    // admitted, and it admitted them from class 1
    expect(idsOf(afterMove)).toEqual(idsOf(before))

    // the wording is live even though the membership is frozen: a renamed
    // department reads as its new name rather than as last year's
    expect(afterRename.find((unit) => unit.id === f.class1)?.name).toBe('Renamed')
    expect(idsOf(afterRename)).toEqual(idsOf(before))
  })

  it('takes somebody out without deleting them, and lets them back in', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('exclusion')
        const assessment = yield* Assessment
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        const first = (yield* assessment.listParticipants(
          f.tenant,
          batch.id,
          { limit: 50 },
          f.principal,
        ))[0]!
        const excluded = yield* assessment.setParticipantStatus(
          f.tenant,
          batch.id,
          first.id,
          'excluded',
          'transferred out',
          f.principal,
        )
        const row = one<{ status: string; excluded_by: string | null; exclusion_reason: string }>(
          yield* runSql(sql`
            select status, excluded_by, exclusion_reason from batch_participants
            where id = ${first.id}`),
        )
        const back = yield* assessment.setParticipantStatus(
          f.tenant,
          batch.id,
          first.id,
          'active',
          undefined,
          f.principal,
        )
        return { excluded, row, back }
      }),
    )
    const { excluded, row, back } = ok(exit)
    expect(excluded.status).toBe('excluded')
    // the row stays, and says who did it and why
    expect(row.status).toBe('excluded')
    expect(row.exclusion_reason).toBe('transferred out')
    expect(row.excluded_by).not.toBeNull()
    expect(back.status).toBe('active')
  })

  it('records a configuration change as one event that moves the counter', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('sugar')
        const assessment = yield* Assessment
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        const renamed = yield* assessment.updateBatch(
          f.tenant,
          batch.id,
          { name: 'Batch, renamed', reason: 'the faculty asked' },
          f.principal,
        )
        const event = one<{ diff: Record<string, unknown> }>(
          yield* runSql(sql`
            select diff from batch_config_revisions where batch_id = ${batch.id}
            order by revision desc limit 1`),
        )
        return { renamed, event }
      }),
    )
    const { renamed, event } = ok(exit)
    expect(renamed.name).toBe('Batch, renamed')
    expect(Object.keys(event.diff)).toEqual(['name'])
    expect(renamed.configRevision).toBe(1)
  })

  it('offers every unit a caller may manage, not the first five hundred', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('wide')
        const assessment = yield* Assessment
        // a school with more units than any one screen was sized for. Path
        // order is pre-order, so a ceiling would leave a coherent tree that
        // is simply missing its tail - and the administrator standing in the
        // tail cannot name their own unit.
        yield* runSql(sql`
          insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
          select ${f.tenant}, ${f.classType}, ${f.gradeB},
                 'Wing ' || n, ('r.b.k' || lpad(n::text, 4, '0'))::ltree, 2
          from generate_series(1, 600) as n`)
        const offered = yield* assessment.scopeOptions(f.tenant, f.principal)
        const total = one<{ count: string }>(
          yield* runSql(sql`
            select count(*)::text as count from org_nodes where tenant_id = ${f.tenant}`),
        ).count
        return { offered, total }
      }),
    )
    const { offered, total } = ok(exit)
    expect(offered.length).toBe(Number(total))
    expect(offered.length).toBeGreaterThan(500)
    // the last unit in path order: the one a ceiling takes away first
    expect(offered.at(-1)!.name).toBe('Wing 600')
  })
})

// Where the organization moves somebody after the round froze them: offered
// as a difference, never applied by itself, and settled only by a decision -
// sync to it, or keep the round's - that is not raised again until the
// organization moves them again (§32.86).
describe.runIf(postgresAvailable).concurrent('placement reconciliation', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-placements')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  const byName = (f: Seeded, batchId: string) =>
    Effect.gen(function* () {
      const assessment = yield* Assessment
      const rows = yield* assessment.listParticipants(f.tenant, batchId, { limit: 50 }, f.principal)
      return new Map(rows.map((row) => [row.displayName, row]))
    })

  const differences = (f: Seeded, batchId: string, as?: Principal) =>
    Effect.flatMap(Assessment, (assessment) =>
      assessment.listParticipantPlacements(f.tenant, batchId, {}, as ?? f.principal),
    )

  it('offers a move without making it, and settles it only by a decision', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('placements')
        const assessment = yield* Assessment
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        // freshly frozen: the round and the organization agree to the byte
        const fresh = yield* differences(f, batch.id)

        yield* f.moveUser(f.s1, f.class2)
        yield* f.setUserType(f.s2, f.teacherType)
        const offered = yield* differences(f, batch.id)
        const marks = yield* byName(f, batch.id)
        const s1 = offered.items.find((row) => row.displayName === 'S1')!
        const s2 = offered.items.find((row) => row.displayName === 'S2')!
        // nothing moved on its own
        const untouched = one<{ anchor: string }>(
          yield* runSql(sql`select assessment_anchor_node_id as anchor from batch_participants
                             where batch_id = ${batch.id} and user_id = ${f.s1}`),
        ).anchor

        const settled = yield* assessment.reconcileParticipantPlacements(
          f.tenant,
          batch.id,
          {
            decisions: [
              {
                participantId: s1.participantId,
                observedFingerprint: s1.observedFingerprint!,
                decision: 'keep',
              },
              {
                participantId: s2.participantId,
                observedFingerprint: s2.observedFingerprint!,
                decision: 'sync',
              },
            ],
            reason: 'stays in its class this term',
          },
          f.principal,
        )
        const after = yield* differences(f, batch.id)
        const rows = rowsOf<{ user_id: string; anchor: string; type: string }>(
          yield* runSql(sql`select user_id, assessment_anchor_node_id as anchor, user_type_id as type
                              from batch_participants where batch_id = ${batch.id}`),
        )
        const events = rowsOf<{ kind: string; reason: string | null; details: Record<string, unknown> }>(
          yield* runSql(sql`select kind, reason, details from batch_participant_events
                             where batch_id = ${batch.id} and kind like 'placement-%'
                             order by kind`),
        )

        // moved again: a new state of the organization, raised again
        yield* f.moveUser(f.s1, f.class3)
        const again = yield* differences(f, batch.id)
        // and back where the round has them: nothing differs any more
        yield* f.moveUser(f.s1, f.class1)
        const home = yield* differences(f, batch.id)
        return { f, fresh, offered, marks, s1, s2, untouched, settled, after, rows, events, again, home }
      }),
    )
    const r = ok(exit)
    expect(r.fresh).toMatchObject({ items: [], changedTotal: 0, unavailableTotal: 0 })
    expect(r.offered.changedTotal).toBe(2)
    expect(r.s1.changes).toEqual(['placement'])
    expect(r.s2.changes).toEqual(['user-type'])
    expect(r.s1.canSync).toBe(true)
    expect(r.s1.frozen.units.at(-1)?.name).toBe('Class 1')
    expect(r.s1.current?.units.at(-1)?.name).toBe('Class 2')
    // the roster itself says who has a difference, and nobody else
    expect(r.marks.get('S1')?.placement).toBe('changed')
    expect(r.marks.get('S4')?.placement).toBe('current')
    expect(r.untouched).toBe(r.s1.frozen.units.at(-1)?.id)

    expect(r.settled).toEqual({ synced: 1, kept: 1 })
    expect(r.after.items).toEqual([])
    // kept stays where the round had it; synced takes the organization's kind
    expect(r.rows.find((row) => row.user_id === r.f.s1)?.anchor).toBe(r.f.class1)
    expect(r.rows.find((row) => row.user_id === r.f.s2)?.type).toBe(r.f.teacherType)
    // kept: the round's placement stands; synced: the organization's is taken
    const kept = r.events.find((event) => event.kind === 'placement-kept')!
    const synced = r.events.find((event) => event.kind === 'placement-synced')!
    expect(kept.reason).toBe('stays in its class this term')
    expect(kept.details).toHaveProperty('observed')
    expect(synced.details).toHaveProperty('previous')

    expect(r.again.items.map((row) => row.displayName)).toEqual(['S1'])
    expect(r.home.items).toEqual([])
  })

  it('sees a class moved whole, not a class renamed', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('ancestry')
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        yield* runSql(sql`update org_nodes set name = 'Class Two' where id = ${f.class2}`)
        const renamed = yield* differences(f, batch.id)
        // the class keeps its id and its people, and now belongs to grade B
        yield* runSql(sql`update org_nodes set parent_id = ${f.gradeB}, path = 'r.b.c2'
                           where id = ${f.class2}`)
        const moved = yield* differences(f, batch.id)
        return { renamed, moved }
      }),
    )
    const { renamed, moved } = ok(exit)
    expect(renamed.items).toEqual([])
    expect(moved.items.map((row) => [row.displayName, row.changes])).toEqual([
      ['S2', ['ancestry']],
    ])
  })

  it('refuses the whole selection when one of it moved again since it was shown', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('stale')
        const assessment = yield* Assessment
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        yield* f.moveUser(f.s1, f.class2)
        yield* f.moveUser(f.s4, f.class2)
        const shown = yield* differences(f, batch.id)
        // somebody moves S4 on while the decision is being made
        yield* f.moveUser(f.s4, f.class3)
        const refused = yield* Effect.exit(
          assessment.reconcileParticipantPlacements(
            f.tenant,
            batch.id,
            {
              decisions: shown.items.map((row) => ({
                participantId: row.participantId,
                observedFingerprint: row.observedFingerprint!,
                decision: 'sync' as const,
              })),
            },
            f.principal,
          ),
        )
        const anchors = rowsOf<{ anchor: string }>(
          yield* runSql(sql`select assessment_anchor_node_id as anchor from batch_participants
                             where batch_id = ${batch.id} and user_id in (${f.s1}, ${f.s4})`),
        ).map((row) => row.anchor)
        return { refused, anchors, f }
      }),
    )
    const { refused, anchors, f } = ok(exit)
    expect(tagOf(refused)).toBe('ASSESSMENT_PARTICIPANT_PLACEMENT_CHANGED')
    // all or nothing: S1 was still as shown, and is not synced either
    expect(anchors).toEqual([f.class1, f.class1])
  })

  it('shows a manager that somebody left their reach, but not where to, and lets them keep', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('beyond')
        const assessment = yield* Assessment
        const batch = yield* activateBatch(f, 'Batch', [f.gradeA])
        // a grade manager: the round is theirs, grade B is not
        const manager = one<{ id: string }>(
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.tenant}, 'Manager', ${f.teacherType}, ${f.gradeA}) returning id`),
        ).id
        const role = one<{ id: string }>(
          yield* runSql(sql`
            insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
            values (${f.tenant}, 'grade', 'Grade', 'org', 'active', 'explicit', 'allow-list')
            returning id`),
        ).id
        const permission = one<{ id: string }>(
          yield* runSql(sql`select id from permissions where code = 'assessment.batch.manage'`),
        ).id
        yield* runSql(sql`insert into role_permissions (tenant_id, role_id, permission_id)
          values (${f.tenant}, ${role}, ${permission})`)
        yield* runSql(sql`
          insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
          values (${f.tenant}, ${manager}, ${role}, ${f.gradeA}, 'subtree')`)
        const asManager: Principal = { tenantId: f.tenant, userId: manager, sessionId: 's' }

        yield* f.moveUser(f.s1, f.class3)
        const shown = yield* differences(f, batch.id, asManager)
        const row = shown.items.find((item) => item.displayName === 'S1')!
        const sync = yield* Effect.exit(
          assessment.reconcileParticipantPlacements(
            f.tenant,
            batch.id,
            {
              decisions: [
                {
                  participantId: row.participantId,
                  observedFingerprint: row.observedFingerprint!,
                  decision: 'sync',
                },
              ],
            },
            asManager,
          ),
        )
        const keep = yield* assessment.reconcileParticipantPlacements(
          f.tenant,
          batch.id,
          {
            decisions: [
              {
                participantId: row.participantId,
                observedFingerprint: row.observedFingerprint!,
                decision: 'keep',
              },
            ],
          },
          asManager,
        )
        return { row, sync, keep }
      }),
    )
    const { row, sync, keep } = ok(exit)
    expect(row.canSync).toBe(false)
    expect(row.currentBeyondReach).toBe(true)
    // that they moved is theirs to see; the other grade's units are not
    expect(row.current).toBeNull()
    expect(tagOf(sync)).toBe('ASSESSMENT_PARTICIPANT_INVALID')
    expect(reasonIn(sync)).toBe('user-out-of-scope')
    expect(keep).toEqual({ synced: 0, kept: 1 })
  })
})
