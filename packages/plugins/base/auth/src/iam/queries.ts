import { sql, type SQL } from 'drizzle-orm'

// The placement rule, owned in one place because four callers decide by it and
// two runtimes execute it.
//
// Both plugins can break the invariant: auth by placing or retyping a person,
// org by retyping the node they already stand at. Both diagnose it. A second
// copy of this predicate would not fail loudly, it would answer differently,
// and a placement rule that answers differently in two places is not a rule.

/**
 * Where a kind of person may stand.
 *
 * The type states its policy rather than having it inferred from an empty
 * list. Reading "no rows" as "anywhere" meant unchecking the last box widened
 * the rule instead of narrowing it, silently and with no stranded-user check.
 */
export const placementLegal = (type: string, orgTypeId: SQL, atRoot: SQL): SQL => {
  const t = sql.raw(type)
  return sql`
    case
      -- a system identity is the tenant's way back in, so it stands at the
      -- root and nowhere else: authority over a person is authority over the
      -- node they stand at, and every node below the root has managers who are
      -- not the tenant's own administrators
      when ${t}.is_system then ${atRoot}
      when ${t}.placement_mode = 'unrestricted' then true
      else exists (
        select 1 from user_type_allowed_org_types a
        where a.tenant_id = ${t}.tenant_id and a.user_type_id = ${t}.id
          and a.org_type_id = ${orgTypeId})
    end`
}

/**
 * How many people a scope leaves standing where their type forbids.
 *
 * A count rather than a list: which people they are is not the caller's
 * business, only that the change would strand them.
 */
export const strandedByQuery = (scope: SQL, orgTypeId: SQL): SQL => sql`
  select count(*)::int as count
  from users u
  join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
  join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
  where ${scope} and not ${placementLegal('t', orgTypeId, sql`n.parent_id is null`)}`

/** the people a node retype would strand, which is what org asks before it retypes */
export const usersBlockingOrgTypeQuery = (
  tenantId: string,
  orgNodeId: string,
  orgTypeId: string,
): SQL =>
  strandedByQuery(
    sql`u.tenant_id = ${tenantId} and u.primary_org_node_id = ${orgNodeId}`,
    sql`${orgTypeId}::uuid`,
  )

/**
 * A session, with everything that decides whether it is still usable.
 *
 * Written as one statement so both runtimes ask the same question. The
 * relational query builder the cordis service uses is promise-shaped, and
 * duplicating the joins for the Effect side would mean two definitions of
 * "this session is still good".
 *
 * The conditions are deliberately returned rather than filtered on: an expired
 * session has to be distinguishable from an unknown one, because the first
 * clears the cookie and can say so and the second must not confirm that a
 * token ever existed.
 */
export const sessionByTokenQuery = (tokenHash: string): SQL => sql`
  select
    s.id, s.tenant_id, s.user_id, s.expires_at, s.last_used_at,
    (s.expires_at <= now()) as expired,
    -- the aliases are worth reading slowly: t is the USER TYPE and n is the
    -- TENANT. Checking t.enabled and forgetting n.enabled leaves a disabled
    -- tenant's sessions working, which is what this expression got wrong once
    (
      u.enabled
      and t.enabled
      and n.enabled
      and (n.expires_at is null or n.expires_at > now())
    ) as usable
  from sessions s
  join users u on u.tenant_id = s.tenant_id and u.id = s.user_id
  join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
  join tenants n on n.id = s.tenant_id
  where s.token_hash = ${tokenHash}`

export const deleteSessionQuery = (sessionId: string): SQL =>
  sql`delete from sessions where id = ${sessionId}`

/** last_used_at is only written when it has gone stale, to keep reads from writing */
export const touchSessionQuery = (sessionId: string): SQL =>
  sql`update sessions set last_used_at = now() where id = ${sessionId}`
