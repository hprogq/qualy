// The shared assembly and fixture for the formula suites: the service
// stack minus the two sandbox-facing layers (each suite decides local or
// remote), and a seeded tenant with an all-active admin.

import { Effect, Layer } from 'effect'
import { sql } from 'kysely'
import { databaseFor, runSql } from '@qualy/plugin-database/testkit'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { accessActions } from '@qualy/plugin-rbac/actions'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { permissions as assessmentPermissions } from '@qualy/plugin-assessment/permissions'
import { assessmentActions } from '@qualy/plugin-assessment/actions'
import { permissions as formulaPermissions } from '../../src/permissions.ts'
import { formulaActions } from '../../src/actions.ts'
import { entities as storageEntities } from '@qualy/plugin-storage/db'
import { entities as assessmentEntities } from '@qualy/plugin-assessment/db'
import { entities } from '../../src/db/entities.ts'

export const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  // the assessment catalog rides along for the end-to-end suite, which
  // drives the real item service; every other suite simply never asks
  { owner: 'assessment', permissions: assessmentPermissions },
  { owner: 'assessment-formula', permissions: formulaPermissions },
])

export const harnessClosure = [
  ...orgEntities,
  ...authEntities,
  ...rbacEntities,
  ...auditEntities,
  // the binding catalog reads a batch's frozen boundary through the
  // assessment access face, so its suite needs the batch tables to exist;
  // every other suite just ignores them
  ...storageEntities,
  ...assessmentEntities,
  ...entities,
] as const

/** everything below the formula layer: rbac, audit, ui registry, database */
export const servicesFor = (url: string) =>
  booted(
    rbacLayer.pipe(
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([
                { owner: 'rbac', actions: accessActions },
                { owner: 'assessment', actions: assessmentActions },
                { owner: 'assessment-formula', actions: formulaActions },
              ]),
            ),
          ),
        ),
      ),
      Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: harnessClosure }))),
    ),
    { catalog },
  )

export const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** a tenant, a root and a college, an all-active admin and a bystander */
export const seedFormulaFixture = (slug: string) =>
  Effect.gen(function* () {
    const t = one<{ id: string }>(
      yield* runSql(sql`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`),
    ).id
    const college = one<{ id: string }>(
      yield* runSql(
        sql`insert into org_types (tenant_id, name) values (${t}, 'College') returning id`,
      ),
    ).id
    const base = slug.replaceAll('-', '_')
    const root = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, name, path, depth)
        values (${t}, ${college}, 'Root', ${base}, 0) returning id`),
    ).id
    const collegeA = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
        values (${t}, ${college}, ${root}, 'College A', ${sql.raw(`'${base}.a'`)}, 1)
        returning id`),
    ).id
    const studentType = one<{ id: string }>(
      yield* runSql(sql`
        insert into user_types (tenant_id, code, name, placement_mode)
        values (${t}, 'student', 'Student', 'unrestricted') returning id`),
    ).id
    const person = (name: string, at: string) =>
      runSql(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
        values (${t}, ${name}, ${studentType}, ${at}) returning id`)
    const admin = one<{ id: string }>(yield* person('Admin', root)).id
    const bystander = one<{ id: string }>(yield* person('Bystander', collegeA)).id
    const adminRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
        values (${t}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
        returning id`),
    ).id
    yield* runSql(
      sql`insert into role_grants (tenant_id, user_id, role_id) values (${t}, ${admin}, ${adminRole})`,
    )
    // Two people who may write formulas, and nothing else. The tenant admin
    // above holds every code by definition, which is exactly what an
    // ownership suite must not lean on: authorship has to separate two
    // people who hold the SAME capability.
    const authorRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status)
        values (${t}, 'formula-author', 'Formula author', 'tenant', 'active') returning id`),
    ).id
    yield* runSql(sql`
      insert into role_permissions (tenant_id, role_id, permission_id)
      select ${t}, ${authorRole}, p.id from permissions p
      where p.code = 'assessment.formula.author'`)
    const authorA = one<{ id: string }>(yield* person('Author A', collegeA)).id
    const authorB = one<{ id: string }>(yield* person('Author B', collegeA)).id
    for (const who of [authorA, authorB]) {
      yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id) values (${t}, ${who}, ${authorRole})`)
    }
    /** takes the authoring capability away, leaving what they wrote alone */
    const revokeAuthoring = (userId: string) =>
      runSql(sql`
        delete from role_grants
        where tenant_id = ${t} and user_id = ${userId} and role_id = ${authorRole}`)

    const principal = (userId: string): Principal => ({ tenantId: t, userId, sessionId: 's' })
    return {
      t,
      root,
      collegeA,
      admin,
      bystander,
      authorA,
      authorB,
      revokeAuthoring,
      principal,
    }
  })
