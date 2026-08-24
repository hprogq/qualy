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
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { userActions } from '@qualy/plugin-auth/actions'
import { serviceLayer as authLayer } from '@qualy/plugin-auth/server'
import { AuthConfig } from '@qualy/plugin-auth/server/sign-in'
import { loginDriversLayer } from '@qualy/auth-contract/login'
import { Org } from '../src/server/index.ts'
import { serviceLayer as orgLayer } from '../src/server/index.ts'

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
// auth's placement suite.

// what the orm must know for a query to name a table: this suite runs auth and
// rbac alongside org, so their tables are part of what the assembly serves
const closure = [...orgEntities, ...authEntities, ...rbacEntities, ...auditEntities] as const

// the same declarations production compiles, stamped the same way
const catalog = compileCatalog([
  { owner: 'org', permissions: orgPermissions },
  { owner: 'auth', permissions: authPermissions },
  { owner: 'rbac', permissions: rbacPermissions },
])

const stack = (url: string) =>
  booted(
    orgLayer.pipe(
      // the same levels the generated runtime derives: auth needs rbac, and
      // both need the database
      Layer.provideMerge(authLayer),
      Layer.provideMerge(rbacLayer),
      // the writer the auth services record through, on the same database
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([{ owner: 'auth', actions: userActions }]),
            ),
          ),
        ),
      ),
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

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

/** a college holding one staff member, an administrator, and a club type to retype into */
const seed = Effect.fn('seed')(function* () {
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('t', 'T') returning id`),
  ).id
  const collegeType = one<{ id: string }>(
    yield* runSql(
      sql`insert into org_types (tenant_id, name) values (${tenant}, 'C') returning id`,
    ),
  ).id
  const clubType = one<{ id: string }>(
    yield* runSql(
      sql`insert into org_types (tenant_id, name) values (${tenant}, 'K') returning id`,
    ),
  ).id
  const root = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${tenant}, ${collegeType}, 'Root', 'r', 0) returning id`),
  ).id
  // the node the cases retype is a child: the root's type is fixed for life,
  // which has its own case below
  const node = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
      values (${tenant}, ${root}, ${collegeType}, 'Branch', 'r.b', 1) returning id`),
  ).id
  yield* runSql(sql`
    insert into org_type_rules (tenant_id, parent_type_id, child_type_id)
    values (${tenant}, ${collegeType}, ${clubType})`)
  const adminType = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${tenant}, 'admin', 'Admin', 'unrestricted') returning id`),
  ).id
  const admin = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Ada', ${adminType}, ${node}) returning id`),
  ).id
  const adminRole = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
      values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
      returning id`),
  ).id
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id) values (${tenant}, ${admin}, ${adminRole})`)
  const principal: Principal = { tenantId: tenant, userId: admin, sessionId: 's' }
  return { tenant, root, node, collegeType, clubType, adminType, principal }
})

/** a staff type that may only stand at a college, with one person standing there */
const addStrandableStaff = Effect.fn('addStaff')(function* (f: {
  tenant: string
  node: string
  collegeType: string
}) {
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const staffType = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${f.tenant}, 'staff', 'Staff', 'allow-list') returning id`),
  ).id
  yield* runSql(sql`
    insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
    values (${f.tenant}, ${staffType}, ${f.collegeType})`)
  yield* runSql(sql`
    insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
    values (${f.tenant}, 'Grace', ${staffType}, ${f.node})`)
})

const typeOf = Effect.fn('typeOf')(function* (nodeId: string) {
  const result = (yield* runSql(
    sql`select org_type_id from org_nodes where id = ${nodeId}`,
  )) as unknown as { rows: { org_type_id: string }[] }
  return result.rows[0]!.org_type_id
})

describe.runIf(postgresAvailable).concurrent('changing a node type across three plugins', () => {
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
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          // an org role anchored here that is allowed on colleges only
          const role = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${f.tenant}, 'dean', 'Dean', 'org', 'active', 'explicit', 'allow-list') returning id`),
          ).id
          yield* runSql(sql`
            insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
            values (${f.tenant}, ${role}, ${f.collegeType})`)
          yield* runSql(sql`
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
          // a principal with no grants at all: the router would have stopped
          // them, and the in-lock check has to stop them too
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const stranger = one<{ id: string }>(
            yield* runSql(sql`
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
          const created = yield* org.createType(f.tenant, { name: 'Department' }, f.principal)
          const listed = yield* org.listTypes(f.tenant, f.principal)
          yield* org.updateType(f.tenant, created.id, { name: 'Dept' }, f.principal)
          const renamed = (yield* org.listTypes(f.tenant, f.principal)).find(
            (type) => type.id === created.id,
          )
          // the seeded college type has a node standing on it
          const inUse = yield* Effect.result(org.deleteType(f.tenant, f.collegeType, f.principal))
          const removable = yield* Effect.result(org.deleteType(f.tenant, created.id, f.principal))
          return {
            createdId: created.id,
            listedCount: listed.length,
            renamed: renamed?.name,
            inUse: tagOf(inUse),
            removable: removable._tag,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.createdId).toBeTruthy()
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

  it('answers a foreign key it has never heard of the same way', async () => {
    // A plugin above this one may point at a node - a round's management
    // boundary does - and org must not learn that plugin's constraint names
    // to answer for it: the dependency runs the other way. Deleting a node is
    // the one place where every reference means the same thing to a reader.
    const db = await createTestContext('effect-org-unknown-fk')
    try {
      // a table this plugin knows nothing about, made the way a plugin above
      // it would have made one
      await db.query(`create table upstairs (
        tenant_id uuid not null,
        org_node_id uuid not null,
        constraint fk_upstairs_node foreign key (tenant_id, org_node_id)
          references org_nodes (tenant_id, id) on delete restrict
      )`)
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const child = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.node}, ${f.collegeType}, 'Leaf', 'r.leaf', 1) returning id`),
          ).id
          yield* runSql(sql`
            insert into upstairs (tenant_id, org_node_id) values (${f.tenant}, ${child})`)
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
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const child = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.node}, ${f.collegeType}, 'Leaf', 'r.leaf', 1) returning id`),
          ).id
          // someone stands on the leaf, so the restrict fk holds it
          yield* runSql(sql`
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
          // the fixture's college is already called that; the name is the
          // identity now, so a second one is a conflict
          const clash = yield* Effect.result(org.createType(f.tenant, { name: 'C' }, f.principal))
          return { tag: tagOf(clash) }
        }),
      )
      expect(ok(exit).tag).toBe('ORG_TYPE_CONFLICT')
    } finally {
      await db.dispose()
    }
  })

  it('gives a self anchor its own node and not the subtree below it', async () => {
    // The recorded incident, end to end. A self anchor once read the whole
    // subtree; the failure is a caller quietly seeing more than they hold, so
    // it is asserted against a real tree rather than only against the
    // projection unit.
    const db = await createTestContext('effect-read-self')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const mid = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.node}, ${f.collegeType}, 'Mid', 'r.b.mid', 2) returning id`),
          ).id
          yield* runSql(sql`
            insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
            values (${f.tenant}, ${mid}, ${f.collegeType}, 'Deep', 'r.b.mid.deep', 3)`)

          // the plain user holds read at `mid` with self coverage only
          const role = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${f.tenant}, 'reader', 'Reader', 'org', 'active', 'explicit', 'allow-list') returning id`),
          ).id
          const permission = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('org.tree.read', 'org', 'read', 'org-node')
              on conflict (code) do update set code = excluded.code returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${role}, ${permission})`)
          const reader = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'Reader', ${f.adminType}, ${f.node}) returning id`),
          ).id
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${reader}, ${role}, ${mid}, 'self')`)

          const org = yield* Org
          const principal = { tenantId: f.tenant, userId: reader, sessionId: 's' }
          const whole = yield* org.readForest(f.tenant, undefined, principal)
          const asked = yield* org.readForest(f.tenant, mid, principal)
          const deep = yield* Effect.result(
            org.readNode(f.tenant, whole.nodes[0]!.id === mid ? mid : mid, principal),
          )
          return {
            wholeIds: whole.nodes.map((node) => node.id),
            askedIds: asked.nodes.map((node) => node.id),
            mid,
            reachable: deep._tag,
          }
        }),
      )
      const answer = ok(exit)
      // the projection is the anchored node alone, in both shapes
      expect(answer.wholeIds).toEqual([answer.mid])
      expect(answer.askedIds).toEqual([answer.mid])
      expect(answer.reachable).toBe('Success')
    } finally {
      await db.dispose()
    }
  })

  it('answers a node the caller cannot see exactly as a missing one', async () => {
    const db = await createTestContext('effect-read-hidden')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          // a user holding nothing at all: every node is invisible to them
          const stranger = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'Nobody', ${f.adminType}, ${f.node}) returning id`),
          ).id
          const asNobody = { tenantId: f.tenant, userId: stranger, sessionId: 's' }
          const org = yield* Org
          const hidden = yield* Effect.result(org.readNode(f.tenant, f.node, asNobody))
          const missing = yield* Effect.result(
            org.readNode(f.tenant, '00000000-0000-7000-8000-000000000000', asNobody),
          )
          return { hidden: tagOf(hidden), missing: tagOf(missing) }
        }),
      )
      const answer = ok(exit)
      // indistinguishable on purpose: a caller must not learn that a node they
      // cannot see exists
      expect(answer.hidden).toBe('ORG_NODE_NOT_FOUND')
      expect(answer.missing).toBe('ORG_NODE_NOT_FOUND')
    } finally {
      await db.dispose()
    }
  })

  it('refuses a move whose subtree the caller does not wholly manage', async () => {
    // The escalation this guards: with a bare self anchor on the node, moving
    // it would drag descendants the caller does not manage into a region they
    // do, and they would gain authority over them. Authority has to cover the
    // whole moved subtree, not just its top.
    const db = await createTestContext('effect-move-escalation')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const src = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.node}, ${f.collegeType}, 'Src', 'r.b.src', 2) returning id`),
          ).id
          yield* runSql(sql`
            insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
            values (${f.tenant}, ${src}, ${f.collegeType}, 'Deep', 'r.b.src.deep', 3)`)
          // the destination is a club, because a type cannot parent itself
          const dest = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.node}, ${f.clubType}, 'Dest', 'r.b.dest', 2) returning id`),
          ).id
          // a college may sit under a club, so the rules do not block the move
          // and the only thing deciding it is coverage
          yield* runSql(sql`
            insert into org_type_rules (tenant_id, parent_type_id, child_type_id)
            values (${f.tenant}, ${f.clubType}, ${f.collegeType})`)

          const role = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${f.tenant}, 'mover', 'Mover', 'org', 'active', 'explicit', 'allow-list') returning id`),
          ).id
          const permission = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('org.tree.manage', 'org', 'manage', 'org-node')
              on conflict (code) do update set code = excluded.code returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${role}, ${permission})`)
          const mover = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'Mover', ${f.adminType}, ${f.node}) returning id`),
          ).id
          // self on the node being moved, subtree on the destination
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${mover}, ${role}, ${src}, 'self')`)
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${mover}, ${role}, ${dest}, 'subtree')`)

          const org = yield* Org
          const asMover = { tenantId: f.tenant, userId: mover, sessionId: 's' }
          const selfAnchored = yield* Effect.result(org.moveNode(f.tenant, src, dest, asMover))

          // widen the same grant to subtree and it becomes allowed
          yield* runSql(sql`
            update role_grants set coverage = 'subtree'
            where user_id = ${mover} and org_node_id = ${src}`)
          const subtreeAnchored = yield* Effect.result(org.moveNode(f.tenant, src, dest, asMover))
          const moved = one<{ path: string }>(
            yield* runSql(sql`select path::text as path from org_nodes where id = ${src}`),
          ).path
          return {
            refused: tagOf(selfAnchored),
            allowed: subtreeAnchored._tag,
            moved,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.refused).toBe('ACCESS_DENIED')
      // the only thing that changed is how far the anchor reaches
      expect(answer.allowed).toBe('Success')
      expect(answer.moved.startsWith('r.b.dest.')).toBe(true)
    } finally {
      await db.dispose()
    }
  })

  // The root's type is fixed for life: its specialness lives in the
  // structure, and the type it stands on is how the tenant's root type is
  // found at all. Everything else about it stays editable - the name is the
  // tenant's - and the type row itself is shielded by the node standing on it.
  it('keeps the root on its type, while the root type stays deletable-proof', async () => {
    const db = await createTestContext('effect-root-type')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          const retyped = yield* Effect.result(
            org.changeNodeType(f.tenant, f.root, f.clubType, f.principal),
          )
          // the type the root stands on refuses deletion through the same
          // in-use door as any other type with a node on it
          const occupied = yield* Effect.result(
            org.deleteType(f.tenant, f.collegeType, f.principal),
          )
          return { retyped: tagOf(retyped), occupied: tagOf(occupied) }
        }),
      )
      const answer = ok(exit)
      expect(answer.retyped).toBe('ORG_NODE_IS_ROOT')
      expect(answer.occupied).toBe('ORG_TYPE_IN_USE')
    } finally {
      await db.dispose()
    }
  })

  it('refuses a node moving into its own subtree', async () => {
    const db = await createTestContext('effect-move-cycle')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const mid = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${f.node}, ${f.collegeType}, 'Mid', 'r.b.mid', 2) returning id`),
          ).id
          const deep = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
              values (${f.tenant}, ${mid}, ${f.collegeType}, 'Deep', 'r.b.mid.deep', 3) returning id`),
          ).id
          const org = yield* Org
          return {
            intoDescendant: tagOf(
              yield* Effect.result(org.moveNode(f.tenant, mid, deep, f.principal)),
            ),
            intoItself: tagOf(yield* Effect.result(org.moveNode(f.tenant, mid, mid, f.principal))),
            root: tagOf(yield* Effect.result(org.moveNode(f.tenant, f.root, mid, f.principal))),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.intoDescendant).toBe('ORG_NODE_INVALID_MOVE')
      expect(answer.intoItself).toBe('ORG_NODE_INVALID_MOVE')
      expect(answer.root).toBe('ORG_NODE_IS_ROOT')
    } finally {
      await db.dispose()
    }
  })
})
