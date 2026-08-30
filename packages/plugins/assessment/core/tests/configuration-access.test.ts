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
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { accessActions } from '@qualy/plugin-rbac/actions'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import type { Orm } from '@qualy/plugin-database/server'
import { entities } from '../src/db/entities.ts'
import { permissions as assessmentPermissions } from '../src/permissions.ts'
import { AssessmentConfigurationAccess } from '../src/plugin.ts'
import { configurationAccessLayer } from '../src/server/configuration-access.ts'

// The narrow face other plugins get about a round's administration, held to
// its two promises apart: requireManage is the ACTOR gate - the same
// frozen-anchors predicate the batch list projects - and boundary is a FACT
// about the round, no actor involved. An unknown batch answers BatchNotFound
// from both; a real batch with no anchors answers an empty boundary, which
// is a different statement and must never collapse into not-found.

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
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([{ owner: 'rbac', actions: accessActions }]),
            ),
          ),
        ),
      ),
      Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
    ),
    { catalog },
  )
  return configurationAccessLayer.pipe(Layer.provideMerge(services))
}

const run = <A, E>(url: string, effect: Effect.Effect<A, E, AssessmentConfigurationAccess | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url) as never) as Effect.Effect<A, E>)

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** two colleges, an administrator anchored at each, and a tenant admin */
const seed = (slug: string) =>
  Effect.gen(function* () {
    const tenant = one<{ id: string }>(
      yield* runSql(sql`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`),
    ).id
    const type = (code: string) =>
      Effect.map(
        runSql(
          sql`insert into org_types (tenant_id, name) values (${tenant}, ${code}) returning id`,
        ),
        (result) => one<{ id: string }>(result).id,
      )
    const schoolType = yield* type('school')
    const collegeType = yield* type('college')
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
    const staffType = one<{ id: string }>(
      yield* runSql(sql`
        insert into user_types (tenant_id, code, name, placement_mode)
        values (${tenant}, 'staff', 'staff', 'unrestricted') returning id`),
    ).id
    const person = (name: string, nodeId: string) =>
      Effect.map(
        runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
          values (${tenant}, ${name}, ${staffType}, ${nodeId}) returning id`),
        (result) => one<{ id: string }>(result).id,
      )
    const owner = yield* person('Owner', root)
    const ownerRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
        values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
        returning id`),
    ).id
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id)
      values (${tenant}, ${owner}, ${ownerRole})`)
    const collegeAdmin = Effect.fn('collegeAdmin')(function* (code: string, nodeId: string) {
      const user = yield* person(code, nodeId)
      const role = one<{ id: string }>(
        yield* runSql(sql`
          insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
          values (${tenant}, ${code}, ${code}, 'org', 'active', 'explicit', 'allow-list')
          returning id`),
      ).id
      const permission = one<{ id: string }>(
        yield* runSql(sql`select id from permissions where code = 'assessment.batch.manage'`),
      ).id
      yield* runSql(sql`
        insert into role_permissions (tenant_id, role_id, permission_id)
        values (${tenant}, ${role}, ${permission})`)
      yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
        values (${tenant}, ${user}, ${role}, ${nodeId}, 'subtree')`)
      return { tenantId: tenant, userId: user, sessionId: 's' } satisfies Principal
    })
    const adminA = yield* collegeAdmin('admin-a', collegeA)
    const adminB = yield* collegeAdmin('admin-b', collegeB)
    const batch = (name: string, anchors: readonly string[]) =>
      Effect.gen(function* () {
        const id = one<{ id: string }>(
          yield* runSql(sql`
            insert into assessment_batches (tenant_id, name, material_range)
            values (${tenant}, ${name}, daterange('2026-03-01', '2026-09-01')) returning id`),
        ).id
        for (const anchor of anchors) {
          yield* runSql(sql`
            insert into batch_management_anchors (tenant_id, batch_id, org_node_id)
            values (${tenant}, ${id}, ${anchor})`)
        }
        return id
      })
    const batchA = yield* batch('Round A', [collegeA])
    const anchorless = yield* batch('Leftover', [])
    return {
      tenant,
      collegeA,
      batchA,
      anchorless,
      admin: { tenantId: tenant, userId: owner, sessionId: 's' } satisfies Principal,
      adminA,
      adminB,
    }
  })

describe.runIf(postgresAvailable)('the configuration access face', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-configuration-access')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('gates the actor by the same predicate the batch list projects', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('cfg-access')
          const access = yield* AssessmentConfigurationAccess
          yield* access.requireManage(f.tenant, f.batchA, f.admin)
          yield* access.requireManage(f.tenant, f.batchA, f.adminA)
          const outside = yield* Effect.exit(access.requireManage(f.tenant, f.batchA, f.adminB))
          return { outside }
        }),
      ),
    )
    expect(Exit.isFailure(outcome.outside)).toBe(true)
    expect(inspect(outcome.outside, { depth: 6 })).toContain('ACCESS_DENIED')
  })

  it('answers an unknown batch as not-found from both faces, tenant-wide included', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('cfg-unknown')
          const access = yield* AssessmentConfigurationAccess
          const ghost = randomUUID()
          const manage = yield* Effect.exit(access.requireManage(f.tenant, ghost, f.admin))
          const fact = yield* Effect.exit(access.boundary(f.tenant, ghost))
          return { manage, fact }
        }),
      ),
    )
    expect(Exit.isFailure(outcome.manage)).toBe(true)
    expect(inspect(outcome.manage, { depth: 6 })).toContain('ASSESSMENT_BATCH_NOT_FOUND')
    expect(Exit.isFailure(outcome.fact)).toBe(true)
    expect(inspect(outcome.fact, { depth: 6 })).toContain('ASSESSMENT_BATCH_NOT_FOUND')
  })

  it('states the boundary as a fact: frozen anchors, or an empty set that is not not-found', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('cfg-boundary')
          const access = yield* AssessmentConfigurationAccess
          const anchored = yield* access.boundary(f.tenant, f.batchA)
          const empty = yield* access.boundary(f.tenant, f.anchorless)
          return { anchored, empty, collegeA: f.collegeA }
        }),
      ),
    )
    expect(outcome.anchored.managementAnchors).toEqual([outcome.collegeA])
    expect(outcome.empty.managementAnchors).toEqual([])
  })
})
