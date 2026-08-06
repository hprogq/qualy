import { sql, type SQL } from 'drizzle-orm'

// The statements the retype path is decided by, owned where both runtimes can
// execute them.
//
// Only the ones changeNodeType needs are here so far. The rest of repo.ts is
// still promise-shaped, and moving it wholesale would be a refactor rather
// than a migration step; these are the ones that already have two callers.

export const NODE_COLUMNS = sql`id, parent_id, org_type_id, code, name, path::text as path, depth, sort_order`

export const nodeQuery = (tenantId: string, nodeId: string): SQL => sql`
  select ${NODE_COLUMNS} from org_nodes
  where tenant_id = ${tenantId} and id = ${nodeId}`

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

export const hasChildrenQuery = (tenantId: string, nodeId: string): SQL => sql`
  select 1 from org_nodes
  where tenant_id = ${tenantId} and parent_id = ${nodeId} limit 1`

export const updateNodeFieldsQuery = (
  tenantId: string,
  nodeId: string,
  fields: { name?: string; sortOrder?: number },
): SQL => sql`
  update org_nodes set
    name = coalesce(${fields.name ?? null}, name),
    sort_order = coalesce(${fields.sortOrder ?? null}, sort_order),
    updated_at = now()
  where tenant_id = ${tenantId} and id = ${nodeId}`

export const deleteNodeQuery = (tenantId: string, nodeId: string): SQL =>
  sql`delete from org_nodes where tenant_id = ${tenantId} and id = ${nodeId}`

// --- org types and the rules between them ---

export const rootQuery = (tenantId: string): SQL => sql`
  select ${NODE_COLUMNS} from org_nodes
  where tenant_id = ${tenantId} and parent_id is null`

/**
 * The snapshot a read projection runs in.
 *
 * Anchors and the tree have to resolve against the same view of the database:
 * without it a concurrent move can tear the response, and a grant revoked
 * mid-read can still contribute nodes. Neither the client nor drizzle exposes
 * an isolation option, so it is set as the transaction's first statement,
 * which is where postgres requires it.
 */
export const readSnapshotQuery: SQL = sql`set transaction isolation level repeatable read, read only`

export const nodesByIdQuery = (tenantId: string, nodeIds: readonly string[]): SQL => sql`
  select ${NODE_COLUMNS} from org_nodes
  where tenant_id = ${tenantId}
    and id = any(string_to_array(${nodeIds.join(',')}, ',')::uuid[])`

export const subtreeQuery = (tenantId: string, rootPath: string): SQL => sql`
  select ${NODE_COLUMNS} from org_nodes
  where tenant_id = ${tenantId} and path <@ ${rootPath}::ltree
  order by path`

/**
 * A new node, with its path written atomically with the row.
 *
 * The id comes from uuidv7() inside the statement so there is no window where
 * the row exists with a placeholder path.
 */
export const insertNodeQuery = (input: {
  tenantId: string
  parentId: string
  parentPath: string
  parentDepth: number
  orgTypeId: string
  code: string | null
  name: string
  sortOrder: number
}): SQL => sql`
  insert into org_nodes (id, tenant_id, parent_id, org_type_id, code, name, path, depth, sort_order)
  select v.id, ${input.tenantId}, ${input.parentId}, ${input.orgTypeId}, ${input.code},
    ${input.name}, (${input.parentPath} || '.' || replace(v.id::text, '-', ''))::ltree,
    ${input.parentDepth + 1}, ${input.sortOrder}
  from (select uuidv7() as id) v
  returning ${NODE_COLUMNS}`

/**
 * The whole subtree relocated by one statement.
 *
 * The moved node takes the exact new path and parent, descendants keep their
 * tail below it, and depth shifts uniformly. Runs under the tenant lock, so
 * the path snapshot cannot go stale between validation and update.
 */
export const moveSubtreeQuery = (input: {
  tenantId: string
  nodeId: string
  newParentId: string
  oldPath: string
  newPath: string
  depthDelta: number
}): SQL => sql`
  update org_nodes set
    parent_id = case when id = ${input.nodeId}::uuid then ${input.newParentId}::uuid else parent_id end,
    path = case
      when id = ${input.nodeId}::uuid then ${input.newPath}::ltree
      else ${input.newPath}::ltree || subpath(path, nlevel(${input.oldPath}::ltree))
    end,
    depth = depth + ${input.depthDelta},
    updated_at = now()
  where tenant_id = ${input.tenantId} and path <@ ${input.oldPath}::ltree`
