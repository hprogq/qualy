import { Effect } from 'effect'
import { sql } from 'kysely'
import { runSql } from '@qualy/plugin-database/testkit'

// One tenant with two people and two providers, for the suites that sign in
// over the wire: Ada, whose type the password door admits; Grace, whose type
// it does not; a password provider whose driver the suite loads; and a cas
// provider whose driver it does not.

/** one tenant with two providers: one whose driver is loaded, one whose is not */
export const seedSignIn = Effect.fn('seedSignIn')(function* (hash: string) {
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
  const user = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Ada', ${userType}, ${node}) returning id`),
  ).id
  const other = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${tenant}, 'Grace', ${ssoOnly}, ${node}) returning id`),
  ).id
  const provider = one<{ id: string }>(
    yield* runSql(sql`
      insert into auth_providers (tenant_id, code, type, name, enabled, sort_order, audience_mode)
      values (${tenant}, 'password', 'local', 'Password', true, 0, 'allow-list') returning id`),
  ).id
  yield* runSql(sql`
    insert into auth_provider_user_types (tenant_id, auth_provider_id, user_type_id)
    values (${tenant}, ${provider}, ${userType})`)
  // enabled, but its driver is not in this assembly's catalog
  yield* runSql(sql`
    insert into auth_providers (tenant_id, code, type, name, enabled, sort_order)
    values (${tenant}, 'campus', 'cas', 'Campus', true, 1)`)
  const identity = (userId: string, identifier: string) =>
    runSql(sql`
      insert into user_identities (tenant_id, user_id, auth_provider_id, identifier, credential_hash)
      values (${tenant}, ${userId}, ${provider}, ${identifier}, ${hash})`)
  yield* identity(user, 'ada')
  yield* identity(other, 'grace')
  return { tenant, user, other }
})
