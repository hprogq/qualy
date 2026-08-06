import { sql } from 'drizzle-orm'
import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { authClosure } from './support/closure.ts'
import { createTestContext, databaseFor, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Database, LegacySql, type Orm } from '@qualy/plugin-database/server'
import { PermissionCatalog } from '@qualy/rbac-contract/effect'
import type { ActivePermission } from '@qualy/rbac-contract'
import { layer as rbacLayer } from '@qualy/plugin-rbac/server'
import { Placement } from '@qualy/auth-contract'
import { LoginDrivers } from '@qualy/auth-contract/login'
import { AuthConfig } from '../src/server/sign-in.ts'
import { Iam, layer as authLayer } from '../src/server/index.ts'

// The port org holds, and the only call org makes into auth.
//
// Two things are being checked. That it answers what the cordis service
// answers, which it must because both run the predicate from iam/queries.ts.
// And that it joins the caller's transaction, which is what lets org ask the
// question about a retype it has written but not committed.

const catalog: readonly ActivePermission[] = []

const stack = (url: string) =>
  authLayer.pipe(
    // auth needs rbac now: closing a sign-in channel has to ask whether the
    // tenant keeps an administrator who can still use one
    Layer.provideMerge(rbacLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        databaseFor(url, { entities: authClosure }),
        Layer.succeed(PermissionCatalog, catalog),
        Layer.succeed(LoginDrivers, []),
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
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Placement | Iam | Database | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

/** a tenant whose staff may only stand at a college, with one person at one */
const seed = Effect.fn('seed')(function* () {
  const db = yield* Database
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* db.execute(sql`insert into tenants (slug, name) values ('t', 'T') returning id`),
  ).id
  const collegeType = one<{ id: string }>(
    yield* db.execute(sql`
      insert into org_types (tenant_id, code, name) values (${tenant}, 'college', 'College')
      returning id`),
  ).id
  const clubType = one<{ id: string }>(
    yield* db.execute(sql`
      insert into org_types (tenant_id, code, name) values (${tenant}, 'club', 'Club')
      returning id`),
  ).id
  const node = one<{ id: string }>(
    yield* db.execute(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${tenant}, ${collegeType}, 'Root', 'r', 0) returning id`),
  ).id
  const userType = one<{ id: string }>(
    yield* db.execute(sql`
      insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
      values (${tenant}, 'staff', 'Staff', true, 'allow-list') returning id`),
  ).id
  // staff may stand at a college and nowhere else
  yield* db.execute(sql`
    insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
    values (${tenant}, ${userType}, ${collegeType})`)
  yield* db.execute(sql`
    insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
    values (${tenant}, 'Ada', ${userType}, ${node})`)
  return { tenant, node, collegeType, clubType }
})

describe.runIf(postgresAvailable).concurrent('the placement port', () => {
  it('counts nobody when the node keeps a type the people standing there allow', async () => {
    const db = await createTestContext('effect-placement-ok')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const placement = yield* Placement
          return yield* placement.usersBlockingOrgType(f.tenant, f.node, f.collegeType)
        }),
      )
      expect(ok(exit)).toBe(0)
    } finally {
      await db.dispose()
    }
  })

  it('counts the person a retype would strand', async () => {
    const db = await createTestContext('effect-placement-strand')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const placement = yield* Placement
          // the person does not move when the node changes under them, so
          // retyping it to a club strands them exactly as a transfer would
          return yield* placement.usersBlockingOrgType(f.tenant, f.node, f.clubType)
        }),
      )
      expect(ok(exit)).toBe(1)
    } finally {
      await db.dispose()
    }
  })

  it('counts a person the caller has moved but not committed', async () => {
    const db = await createTestContext('effect-placement-tx')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const placement = yield* Placement
          // the caller opens its transaction the way org does, which is what
          // decides whether the port lands on the same connection
          const database = yield* LegacySql
          const outside = yield* placement.usersBlockingOrgType(f.tenant, f.node, f.clubType)
          // org's shape: write first, then ask. The question has to be about
          // rows the caller has changed, or a separate connection would answer
          // it identically and prove nothing. A second person moved to this
          // node inside the transaction must be counted.
          const inside = yield* database.transaction((tx) =>
            Effect.gen(function* () {
              const typeId = (
                (yield* tx.execute(
                  sql`select id from user_types where tenant_id = ${f.tenant} limit 1`,
                )) as unknown as { rows: { id: string }[] }
              ).rows[0]!.id
              yield* tx.execute(sql`
                insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
                values (${f.tenant}, 'Grace', ${typeId}, ${f.node})`)
              return yield* placement.usersBlockingOrgType(f.tenant, f.node, f.clubType)
            }),
          )
          return { outside, inside }
        }),
      )
      const answer = ok(exit)
      expect(answer.outside).toBe(1)
      // the uncommitted second person is visible, which is only true if the
      // port joined the caller's transaction rather than taking its own
      // connection
      expect(answer.inside).toBe(2)
    } finally {
      await db.dispose()
    }
  })

  it('scans a whole tenant with the predicate the writes use', async () => {
    const db = await createTestContext('effect-placement-scan')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed()
          const iam = yield* Iam
          const database = yield* Database
          const before = yield* iam.placementViolations(f.tenant)
          // move the node under the person to a type their kind may not stand at
          yield* database.execute(
            sql`update org_nodes set org_type_id = ${f.clubType} where id = ${f.node}`,
          )
          return { before, after: yield* iam.placementViolations(f.tenant) }
        }),
      )
      const answer = ok(exit)
      expect(answer.before).toBe(0)
      // the same rule, asked of every row at once rather than one write
      expect(answer.after).toBe(1)
    } finally {
      await db.dispose()
    }
  })
})
