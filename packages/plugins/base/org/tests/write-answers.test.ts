import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as orgPermissions } from '@qualy/plugin-org/permissions'
import { permissions as authPermissions } from '@qualy/plugin-auth/permissions'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { entities as orgEntities } from '../src/db/entities.ts'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { type Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as authLayer } from '@qualy/plugin-auth/server'
import { AuthConfig } from '@qualy/plugin-auth/server/sign-in'
import { loginDriversLayer } from '@qualy/auth-contract/login'
import { Org, serviceLayer as orgLayer } from '../src/server/index.ts'

// What a write answers.
//
// Two ways the answer used to contradict the write. A caller holding
// org.tree.manage and not org.tree.read committed a rename and was told the
// node does not exist, because the response was built by reading the row back
// through the read permission. And a type still named by somebody else's
// policy was refused by a foreign key no translator knew, so a 409 arrived as
// a defect. Both are about the sentence a committed or refused write says,
// which no other suite here looks at.

const closure = [...orgEntities, ...authEntities, ...rbacEntities] as const

const catalog = compileCatalog([
  { owner: 'org', permissions: orgPermissions },
  { owner: 'auth', permissions: authPermissions },
  { owner: 'rbac', permissions: rbacPermissions },
])

const stack = (url: string) =>
  booted(
    orgLayer.pipe(
      Layer.provideMerge(authLayer),
      Layer.provideMerge(rbacLayer),
      Layer.provideMerge(
        Layer.mergeAll(
          databaseFor(url, { entities: closure }),
          loginDriversLayer,
          uiLayer,
          Layer.succeed(
            AuthConfig,
            AuthConfig.of({
              defaultTenantSlug: 'default',
              sessionTtlSeconds: 604_800,
              secureCookies: false,
            }),
          ),
        ),
      ),
    ),
    { catalog },
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Org | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

const tagOf = (result: unknown) => (result as { failure?: { _tag?: string } }).failure?._tag

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** a university with two colleges, a department under the first, and a spare type */
const seed = Effect.fn('seed')(function* () {
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('t','T') returning id`),
  ).id
  const type = (code: string) =>
    Effect.map(
      runSql(sql`
        insert into org_types (tenant_id, code, name) values (${tenant}, ${code}, ${code})
        returning id`),
      (result) => one<{ id: string }>(result).id,
    )
  const university = yield* type('university')
  const college = yield* type('college')
  const department = yield* type('department')
  const lab = yield* type('lab')
  yield* runSql(sql`
    insert into org_type_rules (tenant_id, parent_type_id, child_type_id)
    values (${tenant}, ${university}, ${college}),
           (${tenant}, ${college}, ${department}),
           (${tenant}, ${college}, ${lab})`)
  const node = (typeId: string, parent: string | null, name: string, path: string, depth: number) =>
    Effect.map(
      runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
        values (${tenant}, ${typeId}, ${parent}, ${name}, ${path}, ${depth}) returning id`),
      (result) => one<{ id: string }>(result).id,
    )
  const root = yield* node(university, null, 'Root', 'r', 0)
  const collegeA = yield* node(college, root, 'College A', 'r.a', 1)
  const collegeB = yield* node(college, root, 'College B', 'r.b', 1)
  const dept = yield* node(department, collegeA, 'Maths', 'r.a.d', 2)

  const adminType = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
      values (${tenant}, 'admin', 'Admin', true, 'unrestricted') returning id`),
  ).id
  const person = (name: string) =>
    Effect.map(
      runSql(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
        values (${tenant}, ${name}, ${adminType}, ${root}) returning id`),
      (result) => one<{ id: string }>(result).id,
    )
  const admin = yield* person('Ada')
  const adminRole = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
      values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
      returning id`),
  ).id
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id) values (${tenant}, ${admin}, ${adminRole})`)

  /** somebody who may change the tree and may not read it: the catalog allows it */
  const manageOnly = Effect.fn('manageOnly')(function* () {
    const user = yield* person('Mo')
    const role = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${tenant}, 'keeper', 'Keeper', 'org', 'active', 'explicit', 'allow-list') returning id`),
    ).id
    const permission = one<{ id: string }>(
      yield* runSql(sql`select id from permissions where code = 'org.tree.manage'`),
    ).id
    yield* runSql(sql`
      insert into role_permissions (tenant_id, role_id, permission_id)
      values (${tenant}, ${role}, ${permission})`)
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
      values (${tenant}, ${user}, ${role}, ${root}, 'subtree')`)
    return { tenantId: tenant, userId: user, sessionId: 's' } satisfies Principal
  })

  const principal: Principal = { tenantId: tenant, userId: admin, sessionId: 's' }
  return {
    tenant,
    root,
    collegeA,
    collegeB,
    dept,
    university,
    college,
    department,
    lab,
    adminType,
    principal,
    manageOnly,
  }
})

const nameOf = (nodeId: string) =>
  Effect.map(
    runSql(sql`select name from org_nodes where id = ${nodeId}`),
    (result) => one<{ name: string }>(result).name,
  )

describe.runIf(postgresAvailable).concurrent('the sentence a write answers with', () => {
  it('hands the written row back to a caller who may write but not read', async () => {
    const db = await createTestContext('effect-org-write-answer')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          const as = yield* f.manageOnly()

          const renamed = yield* org.updateNode(f.tenant, f.dept, { name: 'Applied Maths' }, as)
          const retyped = yield* org.changeNodeType(f.tenant, f.dept, f.lab, as)
          const moved = yield* org.moveNode(f.tenant, f.dept, f.collegeB, as)

          return {
            renamed: renamed.name,
            retypedToLab: retyped.orgTypeId === f.lab,
            movedUnderB: moved.parentId === f.collegeB,
            manageable: moved.manageable,
            stored: yield* nameOf(f.dept),
            // the read this caller does not have, which the response used to
            // be built from: it still refuses, so the row can only come from
            // the write itself
            read: tagOf(yield* Effect.result(org.readNode(f.tenant, f.dept, as))),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.renamed).toBe('Applied Maths')
      expect(answer.stored).toBe('Applied Maths')
      expect(answer.retypedToLab).toBe(true)
      expect(answer.movedUnderB).toBe(true)
      expect(answer.manageable).toBe(true)
      expect(answer.read).toBe('ORG_NODE_NOT_FOUND')
    } finally {
      await db.dispose()
    }
  })

  it('refuses to delete a type a placement allow-list still names', async () => {
    const db = await createTestContext('effect-org-type-allowed')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          // a type nothing stands on and no rule mentions, so both of
          // deleteType's own checks pass
          const spare = yield* org.createType(f.tenant, { code: 'club', name: 'Club' }, f.principal)
          const staffType = one<{ id: string }>(
            yield* runSql(sql`
              insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
              values (${f.tenant}, 'staff', 'Staff', true, 'allow-list') returning id`),
          ).id
          // auth's policy is the only thing left pointing at it
          yield* runSql(sql`
            insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
            values (${f.tenant}, ${staffType}, ${spare.id})`)

          const refused = yield* Effect.result(org.deleteType(f.tenant, spare.id, f.principal))
          const survivors = yield* org.listTypes(f.tenant, f.principal)
          return {
            tag: tagOf(refused),
            kept: survivors.some((type) => type.id === spare.id),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.tag).toBe('ORG_TYPE_IN_USE')
      expect(answer.kept).toBe(true)
    } finally {
      await db.dispose()
    }
  })
})
