import { sql } from 'kysely'
import { Effect } from 'effect'
import { runSql } from '@qualy/plugin-database/testkit'
import { BATCH_STAFF_CODES } from '../../src/permissions.ts'
import { one, type Seeded } from './round.ts'

// Staff who correct concluded claims, for the suites about reopening and
// re-determining: a role carrying the named codes, held at college A over
// its whole subtree, and accepted by the batch the way a synchronisation
// writes it.

/**
 * Somebody new holding a role that carries `codes`, anchored at `at` over
 * its subtree, with the batch having accepted the staff codes among them.
 */
export const appointStaff = (
  f: Seeded,
  batchId: string,
  input: { name: string; at: string; codes: readonly string[] },
) =>
  Effect.gen(function* () {
    const role = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, anchor_mode)
        values (${f.t}, ${`role-${input.name.toLowerCase().replaceAll(' ', '-')}`}, ${input.name},
                'org', 'active', 'allow-list')
        returning id`),
    ).id
    for (const code of input.codes) {
      yield* runSql(sql`
        insert into role_permissions (tenant_id, role_id, permission_id)
        select ${f.t}, ${role}, p.id from permissions p where p.code = ${code}`)
    }
    const who = one<{ id: string }>(
      yield* runSql(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
        values (${f.t}, ${input.name}, ${f.studentType}, ${input.at}) returning id`),
    ).id
    const grant = one<{ id: string }>(
      yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
        values (${f.t}, ${who}, ${role}, ${input.at}, 'subtree') returning id`),
    ).id
    const source = one<{ id: string }>(
      yield* runSql(sql`
        insert into batch_access_sources
          (tenant_id, batch_id, role_assignment_id, subject_id, origin)
        values (${f.t}, ${batchId}, ${grant}, ${who}, 'explicit') returning id`),
    ).id
    for (const code of input.codes) {
      // only what a batch accepts; administering it is live tenant authority
      if (!(BATCH_STAFF_CODES as readonly string[]).includes(code)) continue
      yield* runSql(sql`
        insert into batch_access_source_permissions (tenant_id, source_id, permission_code)
        values (${f.t}, ${source}, ${code})`)
    }
    return { who, role, grant }
  })

/** the college node the seed's first class sits under */
export const collegeOf = (f: Seeded) =>
  Effect.map(
    runSql(sql`select parent_id from org_nodes where id = ${f.classA}`),
    (result) => one<{ parent_id: string }>(result).parent_id,
  )
