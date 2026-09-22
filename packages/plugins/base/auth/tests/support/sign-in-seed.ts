import { Effect } from 'effect'
import { sql } from 'kysely'
import { runSql } from '@qualy/plugin-database/testkit'

// One tenant for the suites that sign in over the wire: Ada, whose type the
// password door admits; Grace, whose type it does not; Lin, who has an
// address and no password yet; Mei, whose password predates the length rule;
// the password door whose driver the suite loads; and a cas door whose driver
// it does not.

export const SEEDED_EMAILS = {
  ada: 'ada@school.edu',
  grace: 'grace@school.edu',
  lin: 'lin@school.edu',
  mei: 'mei@school.edu',
} as const

/** one tenant with two doors: one whose driver is loaded, one whose is not */
export const seedSignIn = Effect.fn('seedSignIn')(function* (
  hash: string,
  shortHash: string = hash,
) {
  const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
  const tenant = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('default','Default') returning id`),
  ).id
  const orgType = one<{ id: string }>(
    yield* runSql(
      sql`insert into org_types (tenant_id, name) values (${tenant}, 'U') returning id`,
    ),
  ).id
  const node = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${tenant}, ${orgType}, 'Root', 'r', 0) returning id`),
  ).id
  const userType = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${tenant},'staff','Staff', 'unrestricted') returning id`),
  ).id
  // a type outside the password door's audience, to prove the refusal is
  // about who the door admits rather than about whether a credential exists
  const ssoOnly = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${tenant},'sso','Sso', 'unrestricted') returning id`),
  ).id
  const person = (name: string, email: string, type: string) =>
    Effect.map(
      runSql(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email)
        values (${tenant}, ${name}, ${type}, ${node}, ${email}) returning id`),
      (result) => one<{ id: string }>(result).id,
    )
  const user = yield* person('Ada', SEEDED_EMAILS.ada, userType)
  const other = yield* person('Grace', SEEDED_EMAILS.grace, ssoOnly)
  const unbound = yield* person('Lin', SEEDED_EMAILS.lin, userType)
  const legacy = yield* person('Mei', SEEDED_EMAILS.mei, userType)
  const provider = one<{ id: string }>(
    yield* runSql(sql`
      insert into auth_providers (tenant_id, code, type, name, enabled, sort_order, audience_mode, is_system)
      values (${tenant}, 'password', 'local', 'Password', true, 0, 'allow-list', true) returning id`),
  ).id
  yield* runSql(sql`
    insert into auth_provider_user_types (tenant_id, auth_provider_id, user_type_id)
    values (${tenant}, ${provider}, ${userType})`)
  // enabled, but its driver is not in this assembly's catalog
  yield* runSql(sql`
    insert into auth_providers (tenant_id, code, type, name, enabled, sort_order)
    values (${tenant}, 'campus', 'cas', 'Campus', true, 1)`)
  const credential = (userId: string, digest: string) =>
    runSql(sql`
      insert into user_auth_bindings (tenant_id, user_id, auth_provider_id, subject, credential_hash)
      values (${tenant}, ${userId}, ${provider}, null, ${digest})`)
  yield* credential(user, hash)
  yield* credential(other, hash)
  yield* credential(legacy, shortHash)
  return { tenant, provider, user, other, unbound, legacy }
})
