import { inspect } from 'node:util'
import { sql } from 'kysely'
import { Effect, Exit, Layer, Result } from 'effect'
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
import { catalogLayers, storageForTest } from './support/catalogs.ts'
import { Assessment, serviceLayer } from '../src/server/index.ts'

// The seam between the tree and the rounds run on it.
//
// A round is administered by whoever reaches the units it runs from and the
// people on it. The units are node ids resolved against the live tree; a
// participant's position was frozen when they were admitted. Relocating a
// class rewrites the live paths and leaves the frozen ones alone, so the two
// halves stop agreeing - and every guard that answers "is this round yours"
// has to keep giving one answer while they disagree. What is asserted here is
// that single answer, not which of the two readings it is built from.

const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  { owner: 'assessment', permissions: assessmentPermissions },
])

const closure = [...orgEntities, ...authEntities, ...rbacEntities, ...entities] as const

const stack = (url: string) => {
  const services = booted(
    rbacLayer.pipe(
      Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
    ),
    { catalog },
  )
  return serviceLayer.pipe(
    Layer.provideMerge(services),
    Layer.provide(catalogLayers),
    Layer.provide(storageForTest().pipe(Layer.provide(services))),
  )
}

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Assessment | Rbac | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/**
 * A school with two colleges and one class under the first of them, plus an
 * administrator scoped to each college and a tenant administrator to move
 * things with.
 */
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
    const schoolType = yield* type('school')
    const collegeType = yield* type('college')
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
    const root = yield* node(schoolType, null, 'School', 'r', 0)
    const collegeA = yield* node(collegeType, root, 'College A', 'r.a', 1)
    const collegeB = yield* node(collegeType, root, 'College B', 'r.b', 1)
    const classC = yield* node(classType, collegeA, 'Class C', 'r.a.c', 2)

    const userType = (code: string) =>
      Effect.map(
        runSql(sql`
          insert into user_types (tenant_id, code, name, placement_mode)
          values (${tenant}, ${code}, ${code}, 'unrestricted') returning id`),
        (result) => one<{ id: string }>(result).id,
      )
    const studentType = yield* userType('student')
    const staffType = yield* userType('staff')
    const person = (name: string, typeId: string, nodeId: string) =>
      Effect.map(
        runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
          values (${tenant}, ${name}, ${typeId}, ${nodeId}) returning id`),
        (result) => one<{ id: string }>(result).id,
      )
    yield* person('S1', studentType, classC)
    yield* person('S2', studentType, classC)

    const owner = yield* person('Owner', staffType, root)
    const ownerRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
        values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
        returning id`),
    ).id
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id)
      values (${tenant}, ${owner}, ${ownerRole})`)

    /** somebody who administers rounds inside one college and nowhere else */
    const collegeAdmin = Effect.fn('collegeAdmin')(function* (name: string, nodeId: string) {
      const user = yield* person(name, staffType, nodeId)
      const role = one<{ id: string }>(
        yield* runSql(sql`
          insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${tenant}, ${name}, ${name}, 'org', 'active', 'explicit', 'allow-list') returning id`),
      ).id
      const permission = one<{ id: string }>(
        yield* runSql(sql`
          select id from permissions where code = 'assessment.batch.manage'`),
      ).id
      yield* runSql(sql`
        insert into role_permissions (tenant_id, role_id, permission_id)
        values (${tenant}, ${role}, ${permission})`)
      yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
        values (${tenant}, ${user}, ${role}, ${nodeId}, 'subtree')`)
      return { tenantId: tenant, userId: user, sessionId: 's' } satisfies Principal
    })

    return {
      tenant,
      root,
      collegeA,
      collegeB,
      classC,
      studentType,
      collegeAdmin,
      owner: { tenantId: tenant, userId: owner, sessionId: 's' } satisfies Principal,
    }
  })

type Seeded = ReturnType<typeof seed> extends Effect.Effect<infer A, infer _E, infer _R> ? A : never

/**
 * A unit relocated under another one, the way the registrar's move leaves the
 * tree: the node takes the new path, its descendants keep their tail below it.
 *
 * The statement rather than the call. org's moveNode is what a registrar
 * actually presses, but @qualy/plugin-org/server needs auth's placement port
 * and this suite's dependencies do not reach it; what matters downstream is
 * only that live paths have been rewritten while frozen ones have not.
 */
const relocate = (tenantId: string, oldPath: string, newPath: string, newParentId: string) =>
  Effect.asVoid(
    runSql(sql`
      update org_nodes set
        parent_id = case when path = ${oldPath}::ltree then ${newParentId}::uuid
          else parent_id end,
        path = case
          when path = ${oldPath}::ltree then ${newPath}::ltree
          else ${newPath}::ltree || subpath(path, nlevel(${oldPath}::ltree))
        end,
        depth = depth + nlevel(${newPath}::ltree) - nlevel(${oldPath}::ltree),
        updated_at = now()
      where tenant_id = ${tenantId} and path <@ ${oldPath}::ltree`),
  )

const draftFrom = (f: Seeded, name: string, orgNodeIds: readonly string[]) =>
  Effect.flatMap(Assessment, (assessment) =>
    assessment.createBatch(
      f.tenant,
      {
        name,
        materialRange: { start: '2026-03-01', end: '2026-09-01' },
        import: { orgNodeIds, userTypeIds: [f.studentType] },
      },
      f.owner,
    ),
  )

/** what the round tells this person they may do, and what it actually lets them do */
const standing = Effect.fn('standing')(function* (
  tenantId: string,
  batchId: string,
  as: Principal,
) {
  const assessment = yield* Assessment
  const listed = yield* assessment.listBatches(tenantId, { limit: 50 }, as)
  const row = listed.find((batch) => batch.id === batchId)
  const write = yield* Effect.result(
    assessment.updateBatch(tenantId, batchId, { name: `renamed by ${as.userId}` }, as),
  )
  const stored = one<{ name: string }>(
    yield* runSql(sql`select name from assessment_batches where id = ${batchId}`),
  ).name
  return {
    listed: row !== undefined,
    manageable: row?.manageable ?? false,
    wrote: Result.isSuccess(write),
    renamed: stored.startsWith('renamed by '),
  }
})

describe.runIf(postgresAvailable).concurrent('a round whose class has been relocated', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-org-move-reach')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('keeps the round with the college that still holds its boundary', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('move-keeps')
        const dean = yield* f.collegeAdmin('dean-a', f.collegeA)
        // run from the college, by the people standing in its class
        const batch = yield* draftFrom(f, 'College A round', [f.collegeA])
        yield* relocate(f.tenant, 'r.a.c', 'r.b.c', f.collegeB)
        return yield* standing(f.tenant, batch.id, dean)
      }),
    )
    const answer = ok(exit)
    // the boundary did not move, so the round is still this dean's
    expect(answer.listed).toBe(true)
    expect(answer.manageable).toBe(true)
    // and being offered the control has to mean the control works
    expect(answer.wrote).toBe(true)
    expect(answer.renamed).toBe(true)
  })

  it('refuses the college the class was moved into a round it cannot see', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('move-refuses')
        const dean = yield* f.collegeAdmin('dean-b', f.collegeB)
        // run from the class itself, so relocating it relocates the boundary
        const batch = yield* draftFrom(f, 'Class C round', [f.classC])
        yield* relocate(f.tenant, 'r.a.c', 'r.b.c', f.collegeB)
        const assessment = yield* Assessment
        const read = yield* Effect.result(assessment.getBatch(f.tenant, batch.id, dean))
        return { ...(yield* standing(f.tenant, batch.id, dean)), read: Result.isSuccess(read) }
      }),
    )
    const answer = ok(exit)
    // the round never became theirs to read
    expect(answer.read).toBe(false)
    expect(answer.listed).toBe(false)
    expect(answer.manageable).toBe(false)
    // so it must not be theirs to write either
    expect(answer.wrote).toBe(false)
    expect(answer.renamed).toBe(false)
  })
})
