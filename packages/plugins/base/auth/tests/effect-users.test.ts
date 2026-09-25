import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import { permissions as orgPermissions } from '@qualy/plugin-org/permissions'
import { permissions as authPermissions } from '@qualy/plugin-auth/permissions'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { sql } from 'kysely'
import { literal } from '@qualy/i18n-contract'
import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { authClosure } from './support/closure.ts'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { type Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { userActions } from '@qualy/plugin-auth/actions'
import { loginDriversLayer, registerLoginDriver } from '@qualy/auth-contract/login'
import { AuthConfig } from '../src/server/sign-in.ts'
import { Iam } from '../src/server/index.ts'
import { serviceLayer as authLayer } from '../src/server/index.ts'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'
import { acceptable, standInChecks } from './support/secret-checks.ts'
import { HARD_LIMITS } from '../src/server/limiter.ts'

// People, and who may administer them.
//
// Authority over a person is authority over the node they stand at, so the
// cases worth stating are the ones where that is not the node the caller was
// thinking of: a transfer touches two nodes, and a retype touches the grants
// the person already holds.

// the same declarations production compiles, stamped the same way
const catalog = compileCatalog([
  { owner: 'org', permissions: orgPermissions },
  { owner: 'auth', permissions: authPermissions },
  { owner: 'rbac', permissions: rbacPermissions },
])

// A driver shaped like the password door, standing in for the real one: the
// core's half of a binding is what these cases are about, and the real
// driver's half is an argon2 digest that would cost most of a second each.
const fakeLocalDriver = registerLoginDriver({
  type: 'local',
  presentation: { mode: 'redirect', href: () => '/nowhere' },
  provisioning: { mode: 'system-singleton', code: 'local', label: literal('Password') },
  resolution: { mode: 'user-field', field: 'email' },
  binding: {
    mode: 'managed',
    secret: { label: { kind: 'literal', value: 'Password' }, minLength: 8, maxLength: 64 },
    // a stand-in judge: long enough, and not the person's own address
    prepare: ({ secret, subject }) =>
      Effect.succeed(
        acceptable(standInChecks(secret, subject))
          ? { ok: true as const, credentialHash: `digest:${secret}` }
          : { ok: false as const, checks: standInChecks(secret, subject) },
      ),
    assess: ({ secret, subject }) => Effect.succeed(standInChecks(secret, subject)),
    verify: ({ secret, credentialHash }) => Effect.succeed(credentialHash === `digest:${secret}`),
  },
})

// A door shaped like campus single sign-on: it keeps nothing about a person
// and takes the business number the other server names as the whole proof.
const fakeCampusDriver = registerLoginDriver({
  type: 'campus',
  presentation: { mode: 'redirect', href: () => '/nowhere' },
  provisioning: { mode: 'tenant-managed', entrance: { label: literal('Campus'), fields: [] } },
  resolution: { mode: 'user-field', field: 'businessNo' },
})

const stack = (url: string) =>
  booted(
    authLayer.pipe(
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
      Layer.provideMerge(captchaLayer),
      Layer.provideMerge(secretsLayer),
      Layer.provideMerge(
        Layer.mergeAll(
          databaseFor(url, { entities: authClosure }),
          Layer.mergeAll(fakeLocalDriver, fakeCampusDriver).pipe(
            Layer.provideMerge(loginDriversLayer),
          ),
          uiLayer,
          Layer.succeed(
            AuthConfig,
            AuthConfig.of({
              defaultTenantSlug: 'default',
              sessionTtlSeconds: 604_800,
              secureCookies: false,
              sessionCookieName: 'qualy_session',
            }),
          ),
        ),
      ),
    ),
    { catalog },
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Iam | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

const one_ = <T>(result: unknown) => (result as { rows: T[] }).rows[0]! as T & { id: string }

const tagOf = (result: { _tag: string; failure?: unknown }) =>
  result._tag === 'Failure' ? (result.failure as { _tag?: string })._tag : undefined

/** two branches, and an administrator who manages only the left one */
const seed = Effect.fn('seed')(function* () {
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('t','T') returning id`),
  ).id

  // the door the sign-in predicate looks for: without one enabled
  // provider admitting a type, nobody of that type can ever sign in
  yield* runSql(sql`
    insert into auth_providers (tenant_id, code, type, name)
    values (${tenant}, 'local', 'local', 'Local')`)
  const orgType = one<{ id: string }>(
    yield* runSql(
      sql`insert into org_types (tenant_id, name) values (${tenant}, 'U') returning id`,
    ),
  ).id
  const node = (name: string, path: string, parent?: string) =>
    runSql(sql`
      insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
      values (${tenant}, ${parent ?? null}, ${orgType}, ${name}, ${path}::ltree,
        ${path.split('.').length - 1})
      returning id`)
  const root = one<{ id: string }>(yield* node('Root', 'r')).id
  const left = one<{ id: string }>(yield* node('Left', 'r.left', root)).id
  const right = one<{ id: string }>(yield* node('Right', 'r.right', root)).id

  const staff = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${tenant}, 'staff', 'Staff', 'unrestricted') returning id`),
  ).id

  // a manager whose authority is the left branch and nothing else
  const manager = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Manager', ${staff}, ${root}) returning id`),
  ).id
  const role = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${tenant}, 'mgr', 'Mgr', 'org', 'active', 'explicit', 'allow-list') returning id`),
  ).id
  const permission = one<{ id: string }>(
    yield* runSql(sql`
      insert into permissions (code, plugin, name, target_kind)
      values ('auth.user.manage', 'auth', 'manage users', 'org-node')
      on conflict (code) do update set code = excluded.code returning id`),
  ).id
  yield* runSql(sql`
    insert into role_permissions (tenant_id, role_id, permission_id)
    values (${tenant}, ${role}, ${permission})`)
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
    values (${tenant}, ${manager}, ${role}, ${left}, 'subtree')`)

  // Reading is granted separately and deliberately unevenly: one node at the
  // root, and the whole right branch. The left branch, which the manager may
  // change, is not readable through it, which is what makes the intersection
  // visible rather than incidental.
  const readRole = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values (${tenant}, 'reader', 'Reader', 'org', 'active', 'explicit', 'allow-list') returning id`),
  ).id
  const readPermission = one<{ id: string }>(
    yield* runSql(sql`
      insert into permissions (code, plugin, name, target_kind)
      values ('auth.user.read', 'auth', 'read users', 'org-node')
      on conflict (code) do update set code = excluded.code returning id`),
  ).id
  yield* runSql(sql`
    insert into role_permissions (tenant_id, role_id, permission_id)
    values (${tenant}, ${readRole}, ${readPermission})`)
  yield* runSql(sql`
    insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
    values (${tenant}, ${manager}, ${readRole}, ${root}, 'self'),
           (${tenant}, ${manager}, ${readRole}, ${right}, 'subtree')`)

  const person = (name: string, at: string) =>
    runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, ${name}, ${staff}, ${at}) returning id`)
  const onLeft = one<{ id: string }>(yield* person('Ada', left)).id
  const onRight = one<{ id: string }>(yield* person('Grace', right)).id

  const as: Principal = { tenantId: tenant, userId: manager, sessionId: 's' }
  return { tenant, root, left, right, staff, manager, as, onLeft, onRight }
})

describe.runIf(postgresAvailable).concurrent('users', () => {
  it('lets a manager create only inside the branch they manage', async () => {
    const db = await createTestContext('effect-users-create')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const inside = yield* Effect.result(
            iam.users.create(
              f.tenant,
              { displayName: 'Ada', userTypeId: f.staff, primaryOrgNodeId: f.left },
              f.as,
            ),
          )
          const outside = yield* Effect.result(
            iam.users.create(
              f.tenant,
              { displayName: 'Grace', userTypeId: f.staff, primaryOrgNodeId: f.right },
              f.as,
            ),
          )
          return { inside: inside._tag, outside: tagOf(outside) }
        }),
      )
      const answer = ok(exit)
      expect(answer.inside).toBe('Success')
      expect(answer.outside).toBe('ACCESS_DENIED')
    } finally {
      await db.dispose()
    }
  })

  // Being allowed to read a person is not being allowed to read the
  // organization - the rule the org path in the same response is already
  // trimmed by. Each duty carries the NAME of the unit it is anchored at,
  // so an unfiltered list told a narrow reader what every unit is called.
  it('names no unit outside the reader\u2019s own reach', async () => {
    const db = await createTestContext('effect-users-holdings-scope')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const f = yield* seed()
          const iam = yield* Iam
          // somebody the reader may read: the seed's reading reach is the
          // right branch, and its managing reach is the left one
          const userId = f.onRight
          const duty = (code: string, nodeId: string) =>
            Effect.gen(function* () {
              const role = one<{ id: string }>(
                yield* runSql(sql`
                  insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
                  values (${f.tenant}, ${code}, ${code}, 'org', 'active', 'explicit', 'unrestricted')
                  returning id`),
              ).id
              yield* runSql(sql`
                insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
                values (${f.tenant}, ${userId}, ${role}, ${nodeId}, 'self')`)
            })
          yield* duty('here', f.right)
          yield* duty('elsewhere', f.left)
          const seen = yield* iam.users.detail(f.as, userId)
          return seen.roles.map((row) => row.roleCode)
        }),
      )
      const codes = ok(exit)
      // the duty inside their reach, and nothing about the other unit
      expect(codes).toEqual(['here'])
    } finally {
      await db.dispose()
    }
  })

  it('needs authority at both ends of a transfer', async () => {
    // moving someone changes who administers them, so managing only where
    // they are now is not enough
    const db = await createTestContext('effect-users-transfer')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const userId = yield* iam.users.create(
            f.tenant,
            { displayName: 'Ada', userTypeId: f.staff, primaryOrgNodeId: f.left },
            f.as,
          )
          // out of the managed branch: refused even though the source is managed
          const out = yield* Effect.result(
            iam.users.setPlacement(f.tenant, userId, f.right, 1, f.as),
          )
          // within it: allowed
          const within = yield* Effect.result(
            iam.users.setPlacement(f.tenant, userId, f.left, 1, f.as),
          )
          return { out: tagOf(out), within: within._tag }
        }),
      )
      const answer = ok(exit)
      expect(answer.out).toBe('ACCESS_DENIED')
      expect(answer.within).toBe('Success')
    } finally {
      await db.dispose()
    }
  })

  it('refuses a placement the type does not permit', async () => {
    const db = await createTestContext('effect-users-placement')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const other = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_types (tenant_id, name) values (${f.tenant}, 'Club')
              returning id`),
          ).id
          // staff may only stand at a club, and the left node is not one
          yield* runSql(sql`
            update user_types set placement_mode = 'allow-list' where id = ${f.staff}`)
          yield* runSql(sql`
            insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
            values (${f.tenant}, ${f.staff}, ${other})`)
          const iam = yield* Iam
          const refused = yield* Effect.result(
            iam.users.create(
              f.tenant,
              { displayName: 'Ada', userTypeId: f.staff, primaryOrgNodeId: f.left },
              f.as,
            ),
          )
          return tagOf(refused)
        }),
      )
      expect(ok(exit)).toBe('USER_TYPE_PLACEMENT_NOT_ALLOWED')
    } finally {
      await db.dispose()
    }
  })

  it('ends every session when a person is disabled', async () => {
    const db = await createTestContext('effect-users-disable')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          // an administrator so the tenant survives the disable
          const adminRole = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
              values (${f.tenant},'admin','Admin','tenant','active','all-active','tenant-admin')
              returning id`),
          ).id
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id)
            values (${f.tenant}, ${f.manager}, ${adminRole})`)

          const iam = yield* Iam
          const userId = yield* iam.users.create(
            f.tenant,
            { displayName: 'Ada', userTypeId: f.staff, primaryOrgNodeId: f.left },
            f.as,
          )
          yield* runSql(sql`
            insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
            select ${f.tenant}, ${userId}, p.id, 'hash', now() + interval '1 day'
              from auth_providers p where p.tenant_id = ${f.tenant} and p.code = 'local'`)
          yield* iam.users.setStatus(
            f.tenant,
            userId,
            { status: 'disabled', expectedVersion: 1 },
            f.as,
          )
          const left = (yield* runSql(
            sql`select count(*)::int as count from sessions where user_id = ${userId}`,
          )) as unknown as { rows: { count: number }[] }
          return left.rows[0]!.count
        }),
      )
      // access ends now, not when the session happens to expire
      expect(ok(exit)).toBe(0)
    } finally {
      await db.dispose()
    }
  })

  it('keeps one spelling of an address, and forgets its proof only when it changes', async () => {
    const db = await createTestContext('effect-users-email')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const stamp = (id: string) =>
            Effect.map(
              runSql<{ email: string | null; verified: boolean; version: number }>(
                sql`select email, email_verified_at is not null as verified, version
                    from users where id = ${id}`,
              ),
              (result) => result.rows[0]!,
            )
          const userId = yield* iam.users.create(
            f.tenant,
            {
              displayName: 'Ada',
              userTypeId: f.staff,
              primaryOrgNodeId: f.left,
              email: '  Ada.Lovelace@School.EDU',
            },
            f.as,
          )
          const created = yield* stamp(userId)
          // as if the person had proved it
          yield* runSql(sql`update users set email_verified_at = now() where id = ${userId}`)
          // the same address in another spelling is not a change
          yield* iam.users.update(f.tenant, userId, { email: 'ada.lovelace@school.edu ' }, 1, f.as)
          const restated = yield* stamp(userId)
          yield* iam.users.update(f.tenant, userId, { email: 'ada@school.edu' }, 2, f.as)
          const changed = yield* stamp(userId)
          yield* iam.users.update(f.tenant, userId, { email: null }, 3, f.as)
          const cleared = yield* stamp(userId)
          return { created, restated, changed, cleared }
        }),
      )
      const answer = ok(exit)
      expect(answer.created).toEqual({
        email: 'ada.lovelace@school.edu',
        verified: false,
        version: 1,
      })
      expect(answer.restated.email).toBe('ada.lovelace@school.edu')
      expect(answer.restated.verified).toBe(true)
      expect(answer.changed).toMatchObject({ email: 'ada@school.edu', verified: false })
      expect(answer.cleared).toMatchObject({ email: null, verified: false })
    } finally {
      await db.dispose()
    }
  })

  it('leaves the recovery account’s address to whoever provisions it', async () => {
    const db = await createTestContext('effect-users-system-email')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
          const systemType = one<{ id: string }>(
            yield* runSql(sql`
              insert into user_types (tenant_id, code, name, placement_mode, is_system)
              values (${f.tenant}, 'system-account', 'System', 'unrestricted', true) returning id`),
          ).id
          const system = one<{ id: string }>(
            yield* runSql(sql`
              insert into users
                (tenant_id, display_name, user_type_id, primary_org_node_id, email, business_no)
              values (${f.tenant}, 'System', ${systemType}, ${f.root}, 'root@school.edu', 'SYS-1')
              returning id`),
          ).id
          // a manager of the whole tree, so authority is not what refuses
          const adminRole = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
              values (${f.tenant},'admin','Admin','tenant','active','all-active','tenant-admin')
              returning id`),
          ).id
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id)
            values (${f.tenant}, ${f.manager}, ${adminRole})`)
          const iam = yield* Iam
          const moved = yield* Effect.result(
            iam.users.update(f.tenant, system, { email: 'other@school.edu' }, 1, f.as),
          )
          // a campus door finds people by their number: handing the account
          // a new one would let whoever owns that number in as the tenant
          const renumbered = yield* Effect.result(
            iam.users.update(f.tenant, system, { businessNo: 'S0001X' }, 1, f.as),
          )
          // saying what it already is changes nothing, and is not refused
          yield* iam.users.update(
            f.tenant,
            system,
            { displayName: 'Platform', email: 'root@school.edu', businessNo: 'SYS-1' },
            1,
            f.as,
          )
          const row = one<{ email: string; display_name: string; business_no: string }>(
            yield* runSql(
              sql`select email, display_name, business_no from users where id = ${system}`,
            ),
          )
          return { moved: tagOf(moved), renumbered: tagOf(renumbered), row }
        }),
      )
      const answer = ok(exit)
      expect(answer.moved).toBe('SYSTEM_ACCOUNT_PROTECTED')
      expect(answer.renumbered).toBe('SYSTEM_ACCOUNT_PROTECTED')
      expect(answer.row).toEqual({
        email: 'root@school.edu',
        display_name: 'Platform',
        business_no: 'SYS-1',
      })
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable).concurrent('what a caller may read about people', () => {
  it('lists by number with the unnumbered first, and a page boundary neither repeats nor skips', async () => {
    const db = await createTestContext('effect-users-order')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          for (const [name, no] of [
            ['Zed', '2023001'],
            ['Amy', '2023010'],
            ['Bob', null],
            ['Cat', '2023002'],
          ] as const) {
            yield* runSql(sql`
              insert into users (tenant_id, display_name, business_no, user_type_id, primary_org_node_id)
              values (${f.tenant}, ${name}, ${no}, ${f.staff}, ${f.right})`)
          }
          const first = yield* iam.users.list(f.as, { orgNodeId: f.right, scope: 'self', limit: 3 })
          const last = first.at(-1)!
          const rest = yield* iam.users.list(f.as, {
            orgNodeId: f.right,
            scope: 'self',
            limit: 50,
            after: [last.businessNo ?? '', last.displayName, last.id],
          })
          return [...first, ...rest].map((row) => `${row.businessNo ?? '-'} ${row.displayName}`)
        }),
      )
      const listed = ok(exit)
      // whoever the fixture already stood there has no number, and neither
      // has Bob: they lead, by name; then the numbers, ascending
      const numbered = listed.filter((row) => !row.startsWith('-'))
      expect(numbered).toEqual(['2023001 Zed', '2023002 Cat', '2023010 Amy'])
      expect(
        listed.slice(0, listed.length - numbered.length).every((row) => row.startsWith('-')),
      ).toBe(true)
      expect(listed).toContain('- Bob')
      expect(new Set(listed).size).toBe(listed.length)
    } finally {
      await db.dispose()
    }
  })

  it('intersects the requested scope with the one the caller was actually granted', async () => {
    // The recorded failure: the requested scope alone decided this, so a bare
    // self grant at a node returned every user below it. A partial subtree is
    // the correct answer here, not an error.
    const db = await createTestContext('effect-users-read')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          // asked for the whole tree; granted read at the root itself and
          // over the right branch only
          const all = yield* iam.users.list(f.as, {
            orgNodeId: f.root,
            scope: 'subtree',
            limit: 50,
          })
          // asked for one node only
          const justRoot = yield* iam.users.list(f.as, {
            orgNodeId: f.root,
            scope: 'self',
            limit: 50,
          })
          // a caller granted nothing sees nothing, and is not told why
          const stranger = one_(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.tenant}, 'Nobody', ${f.staff}, ${f.right}) returning id`),
          ).id
          const blind: Principal = { tenantId: f.tenant, userId: stranger, sessionId: 's' }
          const nothing = yield* iam.users.list(blind, {
            orgNodeId: f.root,
            scope: 'subtree',
            limit: 50,
          })
          const hidden = yield* Effect.result(iam.users.get(blind, f.onLeft))
          // read and manage are asked independently, so a person the manager
          // may change is not thereby a person they may read
          const unreadable = yield* Effect.result(iam.users.get(f.as, f.onLeft))
          const visible = yield* iam.users.get(f.as, f.onRight)
          const search = yield* iam.users.list(f.as, {
            orgNodeId: f.root,
            scope: 'subtree',
            search: 'race',
            limit: 50,
          })
          return { all, justRoot, nothing, hidden, unreadable, visible, search }
        }),
      )
      const answer = ok(exit)
      // Ada is inside the requested subtree and outside the granted one, so
      // she is absent. This is the assertion the recorded bug fails.
      expect(answer.all.map((row) => row.displayName).sort()).toEqual(['Grace', 'Manager'])
      // the manager stands at the root, and is the only one there
      expect(answer.justRoot.map((row) => row.displayName)).toEqual(['Manager'])
      // seen but not editable: two permissions, two answers
      expect(answer.visible.manageable).toBe(false)
      expect(tagOf(answer.unreadable)).toBe('USER_NOT_FOUND')
      // not-found and not-readable are indistinguishable on purpose
      expect(answer.nothing).toEqual([])
      expect(tagOf(answer.hidden)).toBe('USER_NOT_FOUND')
      expect(answer.search.map((row) => row.displayName)).toEqual(['Grace'])
    } finally {
      await db.dispose()
    }
  })

  it('offers every node inside the coverage, not the anchors the grants sit on', async () => {
    // A subtree grant at a college means every department under it is a place
    // a user may stand; returning only the anchor made those unreachable.
    const db = await createTestContext('effect-user-options')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const orgType = one_(
            yield* runSql(
              sql`select id from org_types where tenant_id = ${f.tenant} and name = 'U'`,
            ),
          ).id
          // a node below the subtree anchor: it is a place a user may stand,
          // and returning only the anchor made it unreachable
          yield* runSql(sql`
            insert into org_nodes (tenant_id, parent_id, org_type_id, name, path, depth)
            values (${f.tenant}, ${f.right}, ${orgType}, 'Under', 'r.right.under', 2)`)
          const options = yield* iam.users.options(f.as, undefined, 200)
          // truncation is reported rather than presented as the whole list
          const cut = yield* iam.users.options(f.as, undefined, 1)
          return { options, cut }
        }),
      )
      const answer = ok(exit)
      // Root by its own anchor, and the right branch through a subtree
      // anchor: Deep sits under an anchor the caller may manage but not read,
      // so it is not a place this screen offers
      expect(answer.options.nodes.map((node) => node.name)).toEqual(['Root', 'Right', 'Under'])
      expect(answer.options.nodes.find((node) => node.name === 'Under')!.manageable).toBe(false)
      // the assignable types come back with what each admits, so the screen
      // pairs a person with a place in one round trip
      expect(answer.options.userTypes.map((type) => type.code)).toEqual(['staff'])
      expect(answer.options.userTypes[0]!.placementPolicy).toEqual({ mode: 'unrestricted' })
      expect(answer.options.truncated).toBe(false)
      expect(answer.cut.nodes).toHaveLength(1)
      expect(answer.cut.truncated).toBe(true)
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable).concurrent('the way in written for a person', () => {
  const providerOf = (tenant: string) =>
    Effect.map(
      runSql(sql`select id from auth_providers where tenant_id = ${tenant} and code = 'local'`),
      (found) => one_<{ id: string }>(found).id,
    )
  const bindingsOf = (userId: string) =>
    Effect.map(
      runSql(sql`
        select id, subject, credential_hash, revoked_at is not null as revoked
        from user_auth_bindings where user_id = ${userId} order by bound_at, id`),
      (found) =>
        (
          found as unknown as {
            rows: {
              id: string
              subject: string | null
              credential_hash: string
              revoked: boolean
            }[]
          }
        ).rows,
    )
  const addressed = (userId: string, email: string) =>
    runSql(sql`update users set email = ${email} where id = ${userId}`)

  it('sets, replaces in place and ends the sessions the old password opened', async () => {
    const db = await createTestContext('effect-binding-put')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const provider = yield* providerOf(f.tenant)
          yield* addressed(f.onLeft, 'ada@school.edu')
          const first = yield* iam.users.putBinding(
            f.tenant,
            f.onLeft,
            provider,
            { secret: 'first-secret' },
            f.as,
          )
          yield* runSql(sql`
            insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
            values (${f.tenant}, ${f.onLeft}, ${provider}, 'ada-session', now() + interval '1 day')`)
          const second = yield* iam.users.putBinding(
            f.tenant,
            f.onLeft,
            provider,
            { secret: 'second-secret' },
            f.as,
          )
          const sessions = one_<{ count: number }>(
            yield* runSql(
              sql`select count(*)::int as count, 'x' as id from sessions where user_id = ${f.onLeft}`,
            ),
          ).count
          const events = (yield* runSql(sql`
            select action_code, action_version from audit_events
             where target_id = ${f.onLeft} order by occurred_at, id`)) as unknown as {
            rows: { action_code: string; action_version: number }[]
          }
          return {
            first,
            second,
            sessions,
            rows: yield* bindingsOf(f.onLeft),
            events: events.rows.map((row) => `${row.action_code}@${row.action_version}`),
          }
        }),
      )
      const answer = ok(exit)
      // one binding per person per door: the second put is the first one, rewritten
      expect(answer.second).toBe(answer.first)
      expect(answer.rows).toHaveLength(1)
      // the door finds the person by their own address: the binding holds the
      // driver's digest and no second copy of who they are
      expect(answer.rows[0]).toMatchObject({
        subject: null,
        credential_hash: 'digest:second-secret',
      })
      // a changed secret that left the old session alive would have locked nobody out
      expect(answer.sessions).toBe(0)
      expect(answer.events).toEqual(['auth.identity.bind@2', 'auth.identity.bind@2'])
    } finally {
      await db.dispose()
    }
  })

  it('judges a password being typed for the person, behind the same authority as setting it', async () => {
    const db = await createTestContext('effect-binding-assess')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const provider = yield* providerOf(f.tenant)
          const assess = (userId: string, secret: string) =>
            Effect.result(iam.users.assessBinding(f.tenant, userId, provider, { secret }, f.as))
          yield* addressed(f.onLeft, 'lovelace@school.edu')
          yield* addressed(f.onRight, 'grace@school.edu')
          return {
            fine: yield* assess(f.onLeft, 'quiet river stones'),
            // her own address is the kind of word a password must not carry
            personal: yield* assess(f.onLeft, 'lovelace by the sea'),
            short: yield* assess(f.onLeft, 'short'),
            // Grace stands where the manager may read and not change
            outside: tagOf(yield* assess(f.onRight, 'quiet river stones')),
            rows: yield* bindingsOf(f.onLeft),
          }
        }),
      )
      const answer = ok(exit)
      const checks = (result: { _tag: string; success?: unknown }) =>
        result._tag === 'Success' ? result.success : result
      expect(checks(answer.fine)).toEqual({ length: true, impersonal: true, unguessable: true })
      expect(checks(answer.personal)).toEqual({
        length: true,
        impersonal: false,
        unguessable: true,
      })
      expect(checks(answer.short)).toEqual({ length: false, impersonal: true, unguessable: true })
      expect(answer.outside).toBe('ACCESS_DENIED')
      // judging writes nothing
      expect(answer.rows).toEqual([])
    } finally {
      await db.dispose()
    }
  })

  it('tells somebody who may not administer a person nothing else about them', async () => {
    const db = await createTestContext('effect-users-authority-first')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const provider = yield* providerOf(f.tenant)
          const systemType = one_<{ id: string }>(
            yield* runSql(sql`
              insert into user_types (tenant_id, code, name, placement_mode, is_system)
              values (${f.tenant}, 'system-account', 'System', 'unrestricted', true)
              returning id`),
          ).id
          const system = one_<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email)
              values (${f.tenant}, 'System', ${systemType}, ${f.root}, 'root@school.edu')
              returning id`),
          ).id
          // the manager's reach is the left branch: the root and the right are not theirs
          const stale = 99
          const answers = {
            update: yield* Effect.result(
              iam.users.update(f.tenant, f.onRight, { displayName: 'X' }, stale, f.as),
            ),
            status: yield* Effect.result(
              iam.users.setStatus(
                f.tenant,
                f.onRight,
                { status: 'disabled', expectedVersion: stale },
                f.as,
              ),
            ),
            remove: yield* Effect.result(iam.users.remove(f.tenant, f.onRight, stale, f.as)),
            placement: yield* Effect.result(
              iam.users.setPlacement(f.tenant, system, f.left, stale, f.as),
            ),
            put: yield* Effect.result(
              iam.users.putBinding(f.tenant, system, provider, { secret: 'long-enough' }, f.as),
            ),
            assess: yield* Effect.result(
              iam.users.assessBinding(f.tenant, system, provider, { secret: 'x' }, f.as),
            ),
            revoke: yield* Effect.result(iam.users.revokeBinding(f.tenant, system, provider, f.as)),
          }
          return Object.fromEntries(
            Object.entries(answers).map(([write, answer]) => [write, tagOf(answer)]),
          )
        }),
      )
      expect(ok(exit)).toEqual({
        update: 'ACCESS_DENIED',
        status: 'ACCESS_DENIED',
        remove: 'ACCESS_DENIED',
        placement: 'ACCESS_DENIED',
        put: 'ACCESS_DENIED',
        assess: 'ACCESS_DENIED',
        revoke: 'ACCESS_DENIED',
      })
    } finally {
      await db.dispose()
    }
  })

  it('judges a password typed for somebody else only so often', async () => {
    const db = await createTestContext('effect-binding-assess-throttle')
    try {
      const { limit } = HARD_LIMITS.passwordAssessment
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const provider = yield* providerOf(f.tenant)
          for (let typed = 0; typed < limit; typed += 1) {
            yield* iam.users.assessBinding(
              f.tenant,
              f.onLeft,
              provider,
              { secret: `candidate ${typed}` },
              f.as,
            )
          }
          return tagOf(
            yield* Effect.result(
              iam.users.assessBinding(f.tenant, f.onLeft, provider, { secret: 'one more' }, f.as),
            ),
          )
        }),
      )
      expect(ok(exit)).toBe('TOO_MANY_ATTEMPTS')
    } finally {
      await db.dispose()
    }
  })

  it('refuses whoever may not administer the person, somebody the door cannot find, a password that cannot be one, and a door that does not admit them', async () => {
    const db = await createTestContext('effect-binding-refusals')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const provider = yield* providerOf(f.tenant)
          const put = (userId: string, secret: string) =>
            Effect.result(iam.users.putBinding(f.tenant, userId, provider, { secret }, f.as))
          // Grace stands on the right branch, which the manager may read and not change
          yield* addressed(f.onRight, 'grace@school.edu')
          const outside = yield* put(f.onRight, 'long-enough')
          // Ada has no address yet: a password the door could never find her by
          const unaddressed = yield* put(f.onLeft, 'long-enough')
          yield* addressed(f.onLeft, 'ada@school.edu')
          const badSecret = yield* put(f.onLeft, 'short')
          // the door now admits nobody
          yield* runSql(
            sql`update auth_providers set audience_mode = 'allow-list' where id = ${provider}`,
          )
          const excluded = yield* put(f.onLeft, 'long-enough')
          const unknown = yield* Effect.result(
            iam.users.putBinding(
              f.tenant,
              f.onLeft,
              '00000000-0000-4000-8000-000000000000',
              { secret: 'long-enough' },
              f.as,
            ),
          )
          return {
            outside: tagOf(outside),
            unaddressed: unaddressed._tag === 'Failure' ? unaddressed.failure : null,
            badSecret: tagOf(badSecret),
            excluded: tagOf(excluded),
            unknown: tagOf(unknown),
            rows: yield* bindingsOf(f.onLeft),
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.outside).toBe('ACCESS_DENIED')
      expect(answer.unaddressed).toMatchObject({
        _tag: 'AUTH_BINDING_USER_FIELD_MISSING',
        field: 'email',
      })
      expect(answer.badSecret).toBe('AUTH_BINDING_CREDENTIAL_INVALID')
      expect(answer.excluded).toBe('AUTH_BINDING_AUDIENCE_EXCLUDED')
      expect(answer.unknown).toBe('AUTH_PROVIDER_NOT_FOUND')
      // and none of the refusals wrote anything
      expect(answer.rows).toEqual([])
    } finally {
      await db.dispose()
    }
  })

  it('withdraws a binding without erasing it, and says how each door finds a person', async () => {
    const db = await createTestContext('effect-binding-revoke')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const provider = yield* providerOf(f.tenant)
          yield* addressed(f.onLeft, 'ada@school.edu')
          yield* iam.users.putBinding(f.tenant, f.onLeft, provider, { secret: 'long-enough' }, f.as)
          yield* iam.users.revokeBinding(f.tenant, f.onLeft, provider, f.as)
          const again = yield* Effect.result(
            iam.users.revokeBinding(f.tenant, f.onLeft, provider, f.as),
          )
          const rebound = yield* Effect.result(
            iam.users.putBinding(f.tenant, f.onLeft, provider, { secret: 'long-enough' }, f.as),
          )
          // Grace is readable and not manageable, so her doors carry no controls
          const entrances = yield* iam.users.entrances(f.as, f.onRight)
          return {
            again: tagOf(again),
            rebound: rebound._tag,
            rows: yield* bindingsOf(f.onLeft),
            entrances,
          }
        }),
      )
      const answer = ok(exit)
      expect(answer.again).toBe('AUTH_BINDING_NOT_FOUND')
      expect(answer.rebound).toBe('Success')
      expect(answer.rows.map((row) => row.revoked)).toEqual([true, false])
      expect(answer.entrances.manageable).toBe(false)
      expect(answer.entrances.entrances).toHaveLength(1)
      expect(answer.entrances.entrances[0]).toMatchObject({ type: 'local', bindingId: null })
      expect(answer.entrances.entrances[0]!.resolution).toEqual({
        mode: 'user-field',
        field: 'email',
      })
      expect(answer.entrances.entrances[0]!.binding?.mode).toBe('managed')
      expect(answer.entrances.entrances[0]!.admits === true).toBe(true)
    } finally {
      await db.dispose()
    }
  })

  it('ends the sessions of somebody whose sign-in address changes', async () => {
    const db = await createTestContext('effect-binding-email-change')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const provider = yield* providerOf(f.tenant)
          const count = () =>
            Effect.map(
              runSql(
                sql`select count(*)::int as count, 'x' as id from sessions where user_id = ${f.onLeft}`,
              ),
              (found) => one_<{ count: number }>(found).count,
            )
          const session = (hash: string) =>
            runSql(sql`
              insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
              values (${f.tenant}, ${f.onLeft}, ${provider}, ${hash}, now() + interval '1 day')`)
          // no password at the door: the address is only where notices go
          yield* session('before-password')
          yield* iam.users.update(f.tenant, f.onLeft, { email: 'ada@school.edu' }, 1, f.as)
          const withoutPassword = yield* count()
          yield* iam.users.putBinding(f.tenant, f.onLeft, provider, { secret: 'long-enough' }, f.as)
          yield* session('after-password')
          yield* iam.users.update(f.tenant, f.onLeft, { email: 'ada.l@school.edu' }, 2, f.as)
          const withPassword = yield* count()
          return { withoutPassword, withPassword }
        }),
      )
      const answer = ok(exit)
      expect(answer.withoutPassword).toBe(1)
      expect(answer.withPassword).toBe(0)
    } finally {
      await db.dispose()
    }
  })

  it('ends the sessions a business number opened when it changes, and only those', async () => {
    const db = await createTestContext('effect-binding-number-change')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const local = yield* providerOf(f.tenant)
          const campus = one_<{ id: string }>(
            yield* runSql(sql`
              insert into auth_providers (tenant_id, code, type, name)
              values (${f.tenant}, 'campus', 'campus', 'Campus') returning id`),
          ).id
          yield* runSql(sql`update users set business_no = '2023002' where id = ${f.onLeft}`)
          const doors = () =>
            Effect.map(
              runSql<{ code: string }>(sql`
                select p.code from sessions s
                join auth_providers p on p.id = s.auth_provider_id
                where s.user_id = ${f.onLeft} order by p.code`),
              (found) => found.rows.map((row) => row.code),
            )
          const session = (provider: string, hash: string) =>
            runSql(sql`
              insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
              values (${f.tenant}, ${f.onLeft}, ${provider}, ${hash}, now() + interval '1 day')`)
          // somebody signed in at the campus door under a number that was
          // never Ada's, and Ada herself signed in with a password
          yield* session(campus, 'campus')
          yield* session(local, 'local')
          // restating the number is not a change
          yield* iam.users.update(f.tenant, f.onLeft, { businessNo: '2023002' }, 1, f.as)
          const restated = yield* doors()
          yield* iam.users.update(f.tenant, f.onLeft, { businessNo: '2023001' }, 2, f.as)
          const corrected = yield* doors()
          return { restated, corrected }
        }),
      )
      const answer = ok(exit)
      expect(answer.restated).toEqual(['campus', 'local'])
      expect(answer.corrected).toEqual(['local'])
    } finally {
      await db.dispose()
    }
  })
})

describe
  .runIf(postgresAvailable)
  .concurrent('an account, administered within what one could grant', () => {
    // The manager administers the left branch and holds no grant
    // administration at all. An administrator standing there is a person on
    // their branch whose authority they could never have handed out.
    const withAdministrators = Effect.fn('withAdministrators')(function* () {
      const f = yield* seed()
      const admin = one_<{ id: string }>(
        yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
        values (${f.tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
        returning id`),
      ).id
      const person = (name: string, at: string, email: string, businessNo: string) =>
        Effect.map(
          runSql(sql`
          insert into users
            (tenant_id, display_name, user_type_id, primary_org_node_id, email, business_no)
          values (${f.tenant}, ${name}, ${f.staff}, ${at}, ${email}, ${businessNo})
          returning id`),
          (result) => one_<{ id: string }>(result).id,
        )
      const boss = yield* person('Boss', f.left, 'boss@school.edu', 'B-1')
      const chief = yield* person('Chief', f.root, 'chief@school.edu', 'C-1')
      for (const holder of [boss, chief]) {
        yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id) values (${f.tenant}, ${holder}, ${admin})`)
      }
      // the manager may also delete and read on their branch, so nothing but
      // what Boss holds stands in the way
      const managerRole = one_<{ id: string }>(
        yield* runSql(sql`select id from roles where tenant_id = ${f.tenant} and code = 'mgr'`),
      ).id
      const remove = one_<{ id: string }>(
        yield* runSql(sql`
        insert into permissions (code, plugin, name, target_kind)
        values ('auth.user.delete', 'auth', 'delete users', 'org-node')
        on conflict (code) do update set code = excluded.code returning id`),
      ).id
      yield* runSql(sql`
      insert into role_permissions (tenant_id, role_id, permission_id)
      values (${f.tenant}, ${managerRole}, ${remove})`)
      const readerRole = one_<{ id: string }>(
        yield* runSql(sql`select id from roles where tenant_id = ${f.tenant} and code = 'reader'`),
      ).id
      yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
      values (${f.tenant}, ${f.manager}, ${readerRole}, ${f.left}, 'subtree')`)
      const other = one_<{ id: string }>(
        yield* runSql(sql`
        insert into user_types (tenant_id, code, name, placement_mode)
        values (${f.tenant}, 'other', 'Other', 'unrestricted') returning id`),
      ).id
      const provider = one_<{ id: string }>(
        yield* runSql(
          sql`select id from auth_providers where tenant_id = ${f.tenant} and code = 'local'`,
        ),
      ).id
      yield* runSql(sql`
      insert into user_auth_bindings (tenant_id, user_id, auth_provider_id, credential_hash)
      values (${f.tenant}, ${boss}, ${provider}, 'digest:boss-own-secret')`)
      const chiefAs: Principal = { tenantId: f.tenant, userId: chief, sessionId: 's' }
      return { ...f, boss, chief, chiefAs, other, provider }
    })

    it('refuses a manager every change to the account of somebody holding more than they could grant', async () => {
      const db = await createTestContext('effect-users-account-beyond')
      try {
        const exit = await run(
          db.url,
          Effect.gen(function* () {
            const f = yield* withAdministrators()
            const iam = yield* Iam
            const tried = (write: Effect.Effect<unknown, unknown>) =>
              Effect.map(Effect.result(write), (result) => tagOf(result) ?? result._tag)
            const answers = {
              put: yield* tried(
                iam.users.putBinding(f.tenant, f.boss, f.provider, { secret: 'taken over' }, f.as),
              ),
              assess: yield* tried(
                iam.users.assessBinding(f.tenant, f.boss, f.provider, { secret: 'x' }, f.as),
              ),
              revoke: yield* tried(iam.users.revokeBinding(f.tenant, f.boss, f.provider, f.as)),
              email: yield* tried(
                iam.users.update(f.tenant, f.boss, { email: 'mine@evil.test' }, 1, f.as),
              ),
              number: yield* tried(
                iam.users.update(f.tenant, f.boss, { businessNo: 'X-1' }, 1, f.as),
              ),
              type: yield* tried(
                iam.users.update(f.tenant, f.boss, { userTypeId: f.other }, 1, f.as),
              ),
              disable: yield* tried(
                iam.users.setStatus(
                  f.tenant,
                  f.boss,
                  { status: 'disabled', expectedVersion: 1 },
                  f.as,
                ),
              ),
              move: yield* tried(iam.users.setPlacement(f.tenant, f.boss, f.left, 1, f.as)),
              remove: yield* tried(iam.users.remove(f.tenant, f.boss, 1, f.as)),
              retire: yield* tried(iam.users.provisioning.retireUsers(f.tenant, [f.boss], f.as)),
              // a name is the record, not the account
              rename: yield* tried(
                iam.users.update(f.tenant, f.boss, { displayName: 'The Boss' }, 1, f.as),
              ),
            }
            const row = one_<{
              email: string
              business_no: string
              enabled: boolean
              deleted: boolean
              node: string
              type: string
            }>(
              yield* runSql(sql`
              select email, business_no, enabled, deleted_at is not null as deleted,
                primary_org_node_id as node, user_type_id as type, id
              from users where id = ${f.boss}`),
            )
            const grants = one_<{ count: number }>(
              yield* runSql(sql`
              select count(*)::int as count, 'x' as id from role_grants
              where user_id = ${f.boss} and revoked_at is null`),
            ).count
            const bindings = (yield* runSql(sql`
            select credential_hash, revoked_at is not null as revoked
            from user_auth_bindings where user_id = ${f.boss}`)) as unknown as {
              rows: { credential_hash: string; revoked: boolean }[]
            }
            // the same manager over somebody who holds nothing
            const plain = yield* tried(
              iam.users.setStatus(
                f.tenant,
                f.onLeft,
                { status: 'disabled', expectedVersion: 1 },
                f.as,
              ),
            )
            // and an administrator over the same administrator
            const byPeer = yield* tried(
              iam.users.update(f.tenant, f.boss, { email: 'boss@school.edu.cn' }, 2, f.chiefAs),
            )
            return { answers, row, grants, bindings: bindings.rows, plain, byPeer, f }
          }),
        )
        const answer = ok(exit)
        expect(answer.answers).toEqual({
          put: 'ACCESS_DENIED',
          assess: 'ACCESS_DENIED',
          revoke: 'ACCESS_DENIED',
          email: 'ACCESS_DENIED',
          number: 'ACCESS_DENIED',
          type: 'ACCESS_DENIED',
          disable: 'ACCESS_DENIED',
          move: 'ACCESS_DENIED',
          remove: 'ACCESS_DENIED',
          retire: 'ACCESS_DENIED',
          rename: 'Success',
        })
        // nothing about the account moved
        expect(answer.row).toMatchObject({
          email: 'boss@school.edu',
          business_no: 'B-1',
          enabled: true,
          deleted: false,
          node: answer.f.left,
          type: answer.f.staff,
        })
        expect(answer.grants).toBe(1)
        expect(answer.bindings).toEqual([
          { credential_hash: 'digest:boss-own-secret', revoked: false },
        ])
        expect(answer.plain).toBe('Success')
        expect(answer.byPeer).toBe('Success')
      } finally {
        await db.dispose()
      }
    })

    it('tells the screen which accounts it may change', async () => {
      const db = await createTestContext('effect-users-account-capability')
      try {
        const exit = await run(
          db.url,
          Effect.gen(function* () {
            const f = yield* withAdministrators()
            const iam = yield* Iam
            const boss = yield* iam.users.detail(f.as, f.boss)
            const ada = yield* iam.users.detail(f.as, f.onLeft)
            return {
              boss: { record: boss.user.manageable, account: boss.accountManageable },
              ada: { record: ada.user.manageable, account: ada.accountManageable },
              bossDoors: (yield* iam.users.entrances(f.as, f.boss)).manageable,
              adaDoors: (yield* iam.users.entrances(f.as, f.onLeft)).manageable,
              byPeer: (yield* iam.users.detail(f.chiefAs, f.boss)).accountManageable,
            }
          }),
        )
        expect(ok(exit)).toEqual({
          boss: { record: true, account: false },
          ada: { record: true, account: true },
          bossDoors: false,
          adaDoors: true,
          byPeer: true,
        })
      } finally {
        await db.dispose()
      }
    })

    it('answers an id that names nobody the way it answers somebody out of reach', async () => {
      const db = await createTestContext('effect-users-unknown-id')
      try {
        const exit = await run(
          db.url,
          Effect.gen(function* () {
            const f = yield* seed()
            const iam = yield* Iam
            const provider = one_<{ id: string }>(
              yield* runSql(
                sql`select id from auth_providers where tenant_id = ${f.tenant} and code = 'local'`,
              ),
            ).id
            const gone = one_<{ id: string }>(
              yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id,
                deleted_at, enabled)
              values (${f.tenant}, 'Gone', ${f.staff}, ${f.left}, now(), false) returning id`),
            ).id
            const nobody = '01900000-0000-7000-8000-000000000000'
            const answers = (userId: string) =>
              Effect.gen(function* () {
                const reason = (result: { _tag: string; failure?: unknown }) =>
                  result._tag === 'Failure'
                    ? `${tagOf(result)}:${(result.failure as { reason?: string }).reason ?? ''}`
                    : result._tag
                return [
                  reason(
                    yield* Effect.result(
                      iam.users.update(f.tenant, userId, { displayName: 'X' }, 1, f.as),
                    ),
                  ),
                  reason(
                    yield* Effect.result(
                      iam.users.setStatus(
                        f.tenant,
                        userId,
                        { status: 'disabled', expectedVersion: 1 },
                        f.as,
                      ),
                    ),
                  ),
                  reason(yield* Effect.result(iam.users.remove(f.tenant, userId, 1, f.as))),
                  reason(
                    yield* Effect.result(iam.users.setPlacement(f.tenant, userId, f.left, 1, f.as)),
                  ),
                  reason(
                    yield* Effect.result(
                      iam.users.putBinding(
                        f.tenant,
                        userId,
                        provider,
                        { secret: 'long-enough' },
                        f.as,
                      ),
                    ),
                  ),
                  reason(
                    yield* Effect.result(
                      iam.users.assessBinding(f.tenant, userId, provider, { secret: 'x' }, f.as),
                    ),
                  ),
                  reason(
                    yield* Effect.result(iam.users.revokeBinding(f.tenant, userId, provider, f.as)),
                  ),
                ]
              })
            return {
              nobody: yield* answers(nobody),
              gone: yield* answers(gone),
              // Grace stands on the right branch, which the manager does not administer
              outOfReach: yield* answers(f.onRight),
            }
          }),
        )
        const answer = ok(exit)
        expect(new Set(answer.outOfReach)).toEqual(new Set([answer.outOfReach[0]]))
        expect(answer.outOfReach[0]).toMatch(/^ACCESS_DENIED:/)
        expect(answer.nobody).toEqual(answer.outOfReach)
        expect(answer.gone).toEqual(answer.outOfReach)
      } finally {
        await db.dispose()
      }
    })
  })
