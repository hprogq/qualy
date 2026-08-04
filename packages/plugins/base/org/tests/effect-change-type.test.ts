import { sql } from 'drizzle-orm'
import { Effect, Exit, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Database, DatabaseConfig, layer as databaseLayer } from '@qualy/plugin-database/effect'
import { PermissionCatalog } from '@qualy/rbac-contract/effect'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { layer as rbacLayer } from '@qualy/plugin-rbac/effect'
import { layer as authLayer } from '@qualy/plugin-auth/effect'
import { Org, layer as orgLayer } from '../src/effect/index.ts'

// The slice the whole milestone rests on.
//
// changeNodeType is the only method that touches org, rbac and auth inside one
// locked transaction, so this is where the three layers are shown to compose
// and each peer's refusal is shown to stop the retype.
//
// What it does NOT prove, and the comment here said otherwise before: that the
// peers join the caller's transaction. Every peer check in this method runs
// before anything is written, so it would give the same answer on a separate
// connection, and each refusal returns before the update rather than rolling
// one back. That property is proved where a write precedes the question, in
// auth's placement suite and packages/effect-spike/tests/ambient-transaction.

const catalog: readonly ActivePermission[] = [
  { code: 'org.tree.read', name: 'read', target: 'org-node', plugin: 'org' },
  { code: 'org.tree.manage', name: 'manage', target: 'org-node', plugin: 'org' },
]

const stack = (url: string) =>
  orgLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(rbacLayer, authLayer)),
    Layer.provideMerge(
      Layer.mergeAll(databaseLayer, Layer.succeed(PermissionCatalog, catalog)),
    ),
    Layer.provide(
      Layer.succeed(
        DatabaseConfig,
        DatabaseConfig.of({
          url: Redacted.make(url),
          migrations: 'apply',
          migrationsFolder: new URL('../../../../../db/migrations', import.meta.url).pathname,
        }),
      ),
    ),
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Org | Database>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

/** a college holding one staff member, an administrator, and a club type to retype into */
const seed = Effect.fn('seed')(function* () {
  const db = yield* Database
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* db.execute(sql`insert into tenants (slug, name) values ('t', 'T') returning id`),
  ).id
  const collegeType = one<{ id: string }>(
    yield* db.execute(
      sql`insert into org_types (tenant_id, code, name) values (${tenant}, 'college', 'C') returning id`,
    ),
  ).id
  const clubType = one<{ id: string }>(
    yield* db.execute(
      sql`insert into org_types (tenant_id, code, name) values (${tenant}, 'club', 'K') returning id`,
    ),
  ).id
  const node = one<{ id: string }>(
    yield* db.execute(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${tenant}, ${collegeType}, 'Root', 'r', 0) returning id`),
  ).id
  const adminType = one<{ id: string }>(
    yield* db.execute(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
      values (${tenant}, 'admin', 'Admin', true, 'unrestricted') returning id`),
  ).id
  const admin = one<{ id: string }>(
    yield* db.execute(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Ada', ${adminType}, ${node}) returning id`),
  ).id
  const adminRole = one<{ id: string }>(
    yield* db.execute(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
      values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
      returning id`),
  ).id
  yield* db.execute(sql`
    insert into role_grants (tenant_id, user_id, role_id) values (${tenant}, ${admin}, ${adminRole})`)
  const principal: Principal = { tenantId: tenant, userId: admin, sessionId: 's' }
  return { tenant, node, collegeType, clubType, adminType, principal }
})

/** a staff type that may only stand at a college, with one person standing there */
const addStrandableStaff = Effect.fn('addStaff')(function* (f: {
  tenant: string
  node: string
  collegeType: string
}) {
  const db = yield* Database
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const staffType = one<{ id: string }>(
    yield* db.execute(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
      values (${f.tenant}, 'staff', 'Staff', true, 'allow-list') returning id`),
  ).id
  yield* db.execute(sql`
    insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
    values (${f.tenant}, ${staffType}, ${f.collegeType})`)
  yield* db.execute(sql`
    insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
    values (${f.tenant}, 'Grace', ${staffType}, ${f.node})`)
})

const typeOf = Effect.fn('typeOf')(function* (nodeId: string) {
  const db = yield* Database
  const result = (yield* db.execute(
    sql`select org_type_id from org_nodes where id = ${nodeId}`,
  )) as unknown as { rows: { org_type_id: string }[] }
  return result.rows[0]!.org_type_id
})

describe.runIf(postgresAvailable)('changing a node type across three plugins', () => {
  it('retypes when no peer objects', async () => {
    const db = await createTestContext('effect-retype-ok')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          yield* org.changeNodeType(f.tenant, f.node, f.clubType, f.principal)
          return { now: yield* typeOf(f.node), expected: f.clubType }
        }),
      )
      const answer = ok(exit)
      expect(answer.now).toBe(answer.expected)
    } finally {
      await db.dispose()
    }
  })

  it("refuses when auth's placement rule would strand someone, and leaves the type alone", async () => {
    const db = await createTestContext('effect-retype-strand')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          yield* addStrandableStaff(f)
          const org = yield* Org
          const result = yield* Effect.result(
            org.changeNodeType(f.tenant, f.node, f.clubType, f.principal),
          )
          return {
            tag: tagOf(result),
            // the refusal stopped the retype; it happens before the update, so
            // this is "never written" rather than "written and rolled back"
            stillCollege: (yield* typeOf(f.node)) === f.collegeType,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.tag).toBe('ORG_NODE_PLACEMENT_INCOMPATIBLE')
      expect(answer.stillCollege).toBe(true)
    } finally {
      await db.dispose()
    }
  })

  it("refuses when rbac's grants would no longer allow the type", async () => {
    const db = await createTestContext('effect-retype-grants')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const database = yield* Database
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          // an org role anchored here that is allowed on colleges only
          const role = one<{ id: string }>(
            yield* database.execute(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode)
              values (${f.tenant}, 'dean', 'Dean', 'org', 'active', 'explicit') returning id`),
          ).id
          yield* database.execute(sql`
            insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
            values (${f.tenant}, ${role}, ${f.collegeType})`)
          yield* database.execute(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${f.principal.userId}, ${role}, ${f.node}, 'self')`)

          const org = yield* Org
          const result = yield* Effect.result(
            org.changeNodeType(f.tenant, f.node, f.clubType, f.principal),
          )
          return { tag: tagOf(result), stillCollege: (yield* typeOf(f.node)) === f.collegeType }
        }),
      )
      const answer = ok(exit)
      expect(answer.tag).toBe('ORG_NODE_ASSIGNMENT_INCOMPATIBLE')
      expect(answer.stillCollege).toBe(true)
    } finally {
      await db.dispose()
    }
  })

  it('re-decides authorization under the lock rather than trusting the caller', async () => {
    const db = await createTestContext('effect-retype-authz')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const database = yield* Database
          // a principal with no grants at all: the router would have stopped
          // them, and the in-lock check has to stop them too
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const stranger = one<{ id: string }>(
            yield* database.execute(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'Nobody', ${f.adminType}, ${f.node}) returning id`),
          ).id
          const org = yield* Org
          const result = yield* Effect.result(
            org.changeNodeType(f.tenant, f.node, f.clubType, {
              tenantId: f.tenant,
              userId: stranger,
              sessionId: 's',
            }),
          )
          return { tag: tagOf(result), stillCollege: (yield* typeOf(f.node)) === f.collegeType }
        }),
      )
      const answer = ok(exit)
      expect(answer.tag).toBe('ACCESS_DENIED')
      expect(answer.stillCollege).toBe(true)
    } finally {
      await db.dispose()
    }
  })

  it('manages org types at the root, and refuses to delete one still in use', async () => {
    const db = await createTestContext('effect-org-types')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          const created = yield* org.createType(
            f.tenant,
            { code: 'dept', name: 'Department' },
            f.principal,
          )
          const listed = yield* org.listTypes(f.tenant, f.principal)
          yield* org.updateType(f.tenant, created.id, { name: 'Dept' }, f.principal)
          const renamed = (yield* org.listTypes(f.tenant, f.principal)).find(
            (type) => type.id === created.id,
          )
          // the seeded college type has a node standing on it
          const inUse = yield* Effect.result(
            org.deleteType(f.tenant, f.collegeType, f.principal),
          )
          const removable = yield* Effect.result(
            org.deleteType(f.tenant, created.id, f.principal),
          )
          return {
            createdCode: created.code,
            listedCount: listed.length,
            renamed: renamed?.name,
            inUse: tagOf(inUse),
            removable: removable._tag,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.createdCode).toBe('dept')
      // college, club and the new one
      expect(answer.listedCount).toBe(3)
      expect(answer.renamed).toBe('Dept')
      expect(answer.inUse).toBe('ORG_TYPE_IN_USE')
      expect(answer.removable).toBe('Success')
    } finally {
      await db.dispose()
    }
  })

  it('keeps the type-rule graph acyclic and idempotent', async () => {
    const db = await createTestContext('effect-org-rules')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          yield* org.putRule(f.tenant, f.collegeType, f.clubType, f.principal)
          // repeating converges rather than conflicting, which is why it is a PUT
          const again = yield* Effect.result(
            org.putRule(f.tenant, f.collegeType, f.clubType, f.principal),
          )
          const cycle = yield* Effect.result(
            org.putRule(f.tenant, f.clubType, f.collegeType, f.principal),
          )
          const selfParent = yield* Effect.result(
            org.putRule(f.tenant, f.clubType, f.clubType, f.principal),
          )
          const rules = yield* org.listRules(f.tenant, f.principal)
          const missing = yield* Effect.result(
            org.deleteRule(f.tenant, f.clubType, f.collegeType, f.principal),
          )
          return {
            again: again._tag,
            cycle: tagOf(cycle),
            selfParent: tagOf(selfParent),
            ruleCount: rules.length,
            missing: tagOf(missing),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.again).toBe('Success')
      expect(answer.cycle).toBe('ORG_RULE_CYCLE')
      expect(answer.selfParent).toBe('ORG_RULE_INVALID')
      // the repeat added nothing
      expect(answer.ruleCount).toBe(1)
      expect(answer.missing).toBe('ORG_RULE_NOT_FOUND')
    } finally {
      await db.dispose()
    }
  })

  it('answers a restrict foreign key with the domain error, not a defect', async () => {
    // the delete is blocked by a user standing on the node, which no service
    // check prevents without a race: the constraint is what actually decides,
    // so its violation has to arrive as ORG_NODE_IN_USE rather than a 500
    const db = await createTestContext('effect-org-in-use')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const database = yield* Database
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const child = one<{ id: string }>(
            yield* database.execute(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.node}, ${f.collegeType}, 'Leaf', 'r.leaf', 1) returning id`),
          ).id
          // someone stands on the leaf, so the restrict fk holds it
          yield* database.execute(sql`
            update users set primary_org_node_id = ${child} where tenant_id = ${f.tenant}`)
          const org = yield* Org
          const blocked = yield* Effect.result(org.deleteNode(f.tenant, child, f.principal))
          return { tag: tagOf(blocked) }
        }),
      )
      expect(ok(exit).tag).toBe('ORG_NODE_IN_USE')
    } finally {
      await db.dispose()
    }
  })

  it('answers a duplicate type code with the conflict the contract declares', async () => {
    const db = await createTestContext('effect-org-type-conflict')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          // 'college' already exists from the fixture
          const clash = yield* Effect.result(
            org.createType(f.tenant, { code: 'college', name: 'Another' }, f.principal),
          )
          return { tag: tagOf(clash) }
        }),
      )
      expect(ok(exit).tag).toBe('ORG_TYPE_CONFLICT')
    } finally {
      await db.dispose()
    }
  })
})
