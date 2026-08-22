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
import { Org } from '../src/server/index.ts'
import { serviceLayer as orgLayer } from '../src/server/index.ts'

// The tree behaviours the cordis suite asserted and the Effect suite did not.
//
// Both runtimes executed the same statements from queries.ts, so these are the
// tests that were actually exercising much of that SQL. Each one names the
// cordis test it comes from.

// what the orm must know for a query to name a table: this suite runs auth and
// rbac alongside org, so their tables are part of what the assembly serves
const closure = [...orgEntities, ...authEntities, ...rbacEntities] as const

// the same declarations production compiles, stamped the same way
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

/**
 * The code a refusal carries, or undefined when it succeeded.
 *
 * Reads `failure` rather than checking for `_tag === 'Failure'`: a Result does
 * not always carry that discriminant where a test can see it, and the version
 * that checked for it returned undefined for every refusal - which reads
 * exactly like a call that succeeded.
 */
const tagOf = (result: unknown) => {
  const value = result as { failure?: { _tag?: string } }
  return value.failure?._tag
}

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/**
 * Four levels, because a move has to change a depth to prove anything.
 *
 * A type cannot parent itself (chk_org_type_rules_no_self_loop), so nesting
 * two colleges is not a shortcut to depth: the graph has to be real.
 */
const seed = Effect.fn('seed')(function* () {
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('t','T') returning id`),
  ).id
  const type = (code: string) =>
    runSql(sql`
      insert into org_types (tenant_id, code, name) values (${tenant}, ${code}, ${code})
      returning id`)
  const university = one<{ id: string }>(yield* type('university')).id
  const college = one<{ id: string }>(yield* type('college')).id
  const department = one<{ id: string }>(yield* type('department')).id
  const section = one<{ id: string }>(yield* type('section')).id
  yield* runSql(sql`
    insert into org_type_rules (tenant_id, parent_type_id, child_type_id)
    values (${tenant}, ${university}, ${college}),
           (${tenant}, ${college}, ${department}),
           (${tenant}, ${department}, ${section}),
           (${tenant}, ${university}, ${department})`)
  const root = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${tenant}, ${university}, 'Root', 'r', 0) returning id`),
  ).id
  const adminType = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
      values (${tenant}, 'admin', 'Admin', true, 'unrestricted') returning id`),
  ).id
  const admin = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Ada', ${adminType}, ${root}) returning id`),
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
  return { tenant, root, university, college, department, section, principal }
})

describe.runIf(postgresAvailable).concurrent('what the cordis tree suite covered', () => {
  it('enforces the type rule and the sibling name on creation', async () => {
    // from org.test.ts 'enforces type rules and sibling names on creation'. A
    // node's place in the tree is governed by the rule graph, and two siblings
    // sharing a name is a unique index rather than a service check.
    const db = await createTestContext('effect-org-create')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          const create = (name: string, orgTypeId: string) =>
            Effect.result(
              org.createNode(f.tenant, { parentId: f.root, orgTypeId, name }, f.principal),
            )
          return {
            allowed: yield* create('Arts', f.college),
            // no rule says a section may sit directly under a university
            noRule: yield* create('Physics', f.section),
            // and a sibling cannot repeat a name
            duplicate: yield* create('Arts', f.college),
          }
        }),
      )
      const answer = ok(exit)
      expect(tagOf(answer.allowed)).toBeUndefined()
      expect(tagOf(answer.noRule)).toBe('ORG_NODE_RULE_VIOLATION')
      expect(tagOf(answer.duplicate)).toBe('ORG_NODE_CONFLICT')
    } finally {
      await db.dispose()
    }
  })

  it('protects the root from being moved or deleted', async () => {
    // from org.test.ts 'protects the root from move and delete'. A tenant has
    // exactly one root, and losing it would leave every node unreachable.
    const db = await createTestContext('effect-org-root')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          const college = yield* org.createNode(
            f.tenant,
            { parentId: f.root, orgTypeId: f.college, name: 'Arts' },
            f.principal,
          )
          yield* org.createNode(
            f.tenant,
            { parentId: college.id, orgTypeId: f.department, name: 'Maths' },
            f.principal,
          )
          return {
            move: yield* Effect.result(org.moveNode(f.tenant, f.root, college.id, f.principal)),
            remove: yield* Effect.result(org.deleteNode(f.tenant, f.root, f.principal)),
            // and a node that still has children is not deletable either
            occupied: yield* Effect.result(org.deleteNode(f.tenant, college.id, f.principal)),
          }
        }),
      )
      const answer = ok(exit)
      expect(tagOf(answer.move)).toBe('ORG_NODE_IS_ROOT')
      expect(tagOf(answer.remove)).toBe('ORG_NODE_IS_ROOT')
      expect(tagOf(answer.occupied)).toBe('ORG_NODE_HAS_CHILDREN')
    } finally {
      await db.dispose()
    }
  })

  it('rewrites path and depth for the whole subtree when a node moves', async () => {
    // from org.test.ts 'rewrites path and depth for the whole subtree on move'.
    // path and depth are a derived projection of parent_id, and a move that
    // updated only the moved node would leave every descendant describing a
    // tree that no longer exists.
    const db = await createTestContext('effect-org-move')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          const node = (parentId: string, name: string, orgTypeId: string) =>
            org.createNode(f.tenant, { parentId, orgTypeId, name }, f.principal)
          const left = yield* node(f.root, 'Left', f.college)
          const middle = yield* node(left.id, 'Middle', f.department)
          const leaf = yield* node(middle.id, 'Leaf', f.section)

          // up a level, so the depth of the whole subtree has to shift
          yield* org.moveNode(f.tenant, middle.id, f.root, f.principal)

          const rows = (
            (yield* runSql(sql`
              select id, parent_id, path::text as path, depth from org_nodes
              where tenant_id = ${f.tenant} order by path`)) as unknown as {
              rows: { id: string; parent_id: string | null; path: string; depth: number }[]
            }
          ).rows
          const byId = new Map(rows.map((row) => [row.id, row]))
          return { rows, middle: byId.get(middle.id)!, leaf: byId.get(leaf.id)!, root: f.root }
        }),
      )
      const answer = ok(exit)
      expect(answer.middle.parent_id).toBe(answer.root)
      expect(answer.middle.depth).toBe(1)
      // the descendant moved with it: its path is the new parent path plus its
      // own tail, and its depth shifted by the same amount
      expect(answer.leaf.depth).toBe(2)
      expect(answer.leaf.path.startsWith(`${answer.middle.path}.`)).toBe(true)
      // and every row still agrees with its parent chain
      for (const row of answer.rows) {
        if (row.parent_id === null) {
          expect(row.depth).toBe(0)
          continue
        }
        const parent = answer.rows.find((candidate) => candidate.id === row.parent_id)!
        expect(row.depth).toBe(parent.depth + 1)
        expect(row.path.startsWith(`${parent.path}.`)).toBe(true)
      }
    } finally {
      await db.dispose()
    }
  })

  it('refuses to move a node onto itself', async () => {
    // from org.test.ts 'rejects self moves and moves into the own subtree'. The
    // descendant case is covered elsewhere; this is the degenerate one, which a
    // path containment check answers only if it treats a node as inside itself.
    const db = await createTestContext('effect-org-self-move')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          const child = yield* org.createNode(
            f.tenant,
            { parentId: f.root, orgTypeId: f.college, name: 'Arts' },
            f.principal,
          )
          return yield* Effect.result(org.moveNode(f.tenant, child.id, child.id, f.principal))
        }),
      )
      expect(tagOf(ok(exit))).toBe('ORG_NODE_INVALID_MOVE')
    } finally {
      await db.dispose()
    }
  })

  it("keeps one tenant out of another tenant's tree", async () => {
    // from org.test.ts 'keeps tenants isolated at the service level'. Every
    // statement is tenant scoped, so a node of another tenant has to answer as
    // absent rather than as forbidden or, worse, as found.
    const db = await createTestContext('effect-org-tenants')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          const other = one<{ id: string }>(
            yield* runSql(
              sql`insert into tenants (slug, name) values ('other','Other') returning id`,
            ),
          ).id
          const otherType = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_types (tenant_id, code, name)
              values (${other}, 'college', 'C') returning id`),
          ).id
          const otherRoot = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_nodes (tenant_id, org_type_id, name, path, depth)
              values (${other}, ${otherType}, 'Theirs', 'r', 0) returning id`),
          ).id
          return {
            read: yield* Effect.result(org.readNode(f.tenant, otherRoot, f.principal)),
            // and asking about the other tenant is a wiring mistake rather
            // than a refusal: the api never does it, so it dies rather than
            // quietly answering "not found" and hiding the bug
            readOther: yield* Effect.exit(org.readNode(other, otherRoot, f.principal)),
            write: yield* Effect.result(
              org.updateNode(f.tenant, otherRoot, { name: 'Mine now' }, f.principal),
            ),
            stillTheirs: one<{ name: string }>(
              yield* runSql(sql`select name from org_nodes where id = ${otherRoot}`),
            ).name,
          }
        }),
      )
      const answer = ok(exit)
      // scoped to their own tenant, another tenant's node simply is not there
      expect(tagOf(answer.read)).toBe('ORG_NODE_NOT_FOUND')
      // and naming the other tenant does not help: authority is read from the
      // principal's own tenant, so there is none to find there
      expect(Exit.isFailure(answer.readOther)).toBe(true)
      // A write refuses before it looks: authority is decided at the node, and
      // a node outside the tenant is one nobody has authority at. Read answers
      // "not found" and write answers "denied", and neither reveals whether
      // the node exists, since both say the same thing for a made-up id.
      expect(tagOf(answer.write)).toBe('ACCESS_DENIED')
      expect(answer.stillTheirs).toBe('Theirs')
    } finally {
      await db.dispose()
    }
  })

  it('reports subtree capability apart from single-node capability', async () => {
    // from org.test.ts 'reports subtree capability separately'. A move
    // relocates everything underneath, so a caller who may edit one node is
    // not thereby a caller who may move it; the projection has to say both.
    const db = await createTestContext('effect-org-capability')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const org = yield* Org
          const child = yield* org.createNode(
            f.tenant,
            { parentId: f.root, orgTypeId: f.college, name: 'Arts' },
            f.principal,
          )
          // a manager holding manage at the child, self coverage only
          const manager = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              select ${f.tenant}, 'Mgr', user_type_id, ${f.root} from users
              where tenant_id = ${f.tenant} limit 1
              returning id`),
          ).id
          const role = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${f.tenant}, 'mgr', 'Mgr', 'org', 'active', 'explicit', 'allow-list') returning id`),
          ).id
          const permission = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('org.tree.manage','org','manage','org-node')
              on conflict (code) do update set code = excluded.code returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${role}, ${permission})`)
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.tenant}, ${manager}, ${role}, ${child.id}, 'self')`)
          const readPermission = one<{ id: string }>(
            yield* runSql(sql`
              insert into permissions (code, plugin, name, target_kind)
              values ('org.tree.read','org','read','org-node')
              on conflict (code) do update set code = excluded.code returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            values (${f.tenant}, ${role}, ${readPermission})`)
          const as: Principal = { tenantId: f.tenant, userId: manager, sessionId: 's' }
          return yield* org.readNode(f.tenant, child.id, as)
        }),
      )
      const answer = ok(exit)
      // may edit the node itself
      expect(answer.manageable).toBe(true)
      // and may not move it, because a self anchor promises nothing below
      expect(answer.subtreeManageable).toBe(false)
    } finally {
      await db.dispose()
    }
  })
})
