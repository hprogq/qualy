import { sql, type SQL } from 'drizzle-orm'

// The statements the retype path is decided by, owned where both runtimes can
// execute them.
//
// Only the ones changeNodeType needs are here so far. The rest of repo.ts is
// still promise-shaped, and moving it wholesale would be a refactor rather
// than a migration step; these are the ones that already have two callers.

export const NODE_COLUMNS = sql`id, parent_id, org_type_id, code, name, path::text as path, depth, sort_order`

/**
 * Serializes every structural write of one tenant.
 *
 * rbac's assignment writes and auth's identity writes take the same lock, so
 * the three plugins cannot interleave a retype with a grant or a transfer.
 */
export const lockTenantQuery = (tenantId: string): SQL =>
  sql`select 1 from tenants where id = ${tenantId} for update`

export const nodeQuery = (tenantId: string, nodeId: string): SQL => sql`
  select ${NODE_COLUMNS} from org_nodes
  where tenant_id = ${tenantId} and id = ${nodeId}`

export const typeQuery = (tenantId: string, typeId: string): SQL => sql`
  select id, code, name, sort_order from org_types
  where tenant_id = ${tenantId} and id = ${typeId}`

export const ruleExistsQuery = (
  tenantId: string,
  parentTypeId: string,
  childTypeId: string,
): SQL => sql`
  select 1 from org_type_rules
  where tenant_id = ${tenantId}
    and parent_type_id = ${parentTypeId} and child_type_id = ${childTypeId}`

/** children whose own type the new parent type would not permit */
export const incompatibleChildTypesQuery = (
  tenantId: string,
  nodeId: string,
  newTypeId: string,
): SQL => sql`
  select distinct child.org_type_id
  from org_nodes child
  where child.tenant_id = ${tenantId} and child.parent_id = ${nodeId}
    and not exists (
      select 1 from org_type_rules r
      where r.tenant_id = ${tenantId}
        and r.parent_type_id = ${newTypeId}
        and r.child_type_id = child.org_type_id
    )`

export const setNodeTypeQuery = (tenantId: string, nodeId: string, typeId: string): SQL => sql`
  update org_nodes set org_type_id = ${typeId}, updated_at = now()
  where tenant_id = ${tenantId} and id = ${nodeId}`
