import { sql } from 'drizzle-orm'
import type { Context } from 'cordis'

// data access only: tenant-scoped queries against an explicit handle (the
// service passes its transaction), no authorization, no orpc errors. Rows
// never travel beyond the service/router boundary as DTOs.

type Drizzle = Context['db']['drizzle']
export type OrgTx = Parameters<Parameters<Drizzle['transaction']>[0]>[0]
export type OrgDb = Drizzle | OrgTx

export type NodeRow = {
  id: string
  parent_id: string | null
  org_type_id: string
  code: string | null
  name: string
  path: string
  depth: number
  sort_order: number
}

export type TypeRow = {
  id: string
  code: string
  name: string
  sort_order: number
}

export type RuleRow = {
  parent_type_id: string
  child_type_id: string
}

// ltree labels only allow [A-Za-z0-9_]; node labels are the node's uuid
// without hyphens, so paths are derived purely from ids
export const pathLabel = (id: string) => id.replaceAll('-', '')

import {
  NODE_COLUMNS,
  incompatibleChildTypesQuery,
  lockTenantQuery,
  nodeQuery,
  ruleExistsQuery,
  setNodeTypeQuery,
} from './queries.ts'

// serializes all structural writes of one tenant (and, through the same
// lock in rbac's assignment writes, the topology readers that matter)
export async function lockTenant(tx: OrgTx, tenantId: string): Promise<void> {
  const row = (await tx.execute(lockTenantQuery(tenantId))).rows[0]
  if (!row) throw new Error(`tenant ${tenantId} does not exist`)
}

export async function getNode(db: OrgDb, tenantId: string, nodeId: string) {
  const result = await db.execute<NodeRow>(nodeQuery(tenantId, nodeId))
  return result.rows[0]
}

export async function getRoot(db: OrgDb, tenantId: string) {
  const result = await db.execute<NodeRow>(sql`
    select ${NODE_COLUMNS} from org_nodes
    where tenant_id = ${tenantId} and parent_id is null`)
  return result.rows[0]
}

export async function getNodes(db: OrgDb, tenantId: string, nodeIds: readonly string[]) {
  if (nodeIds.length === 0) return []
  const result = await db.execute<NodeRow>(sql`
    select ${NODE_COLUMNS} from org_nodes
    where tenant_id = ${tenantId}
      and id = any(string_to_array(${nodeIds.join(',')}, ',')::uuid[])`)
  return result.rows
}

// whole subtree including the root of it, stable pre-order via path
export async function listSubtree(db: OrgDb, tenantId: string, rootPath: string) {
  const result = await db.execute<NodeRow>(sql`
    select ${NODE_COLUMNS} from org_nodes
    where tenant_id = ${tenantId} and path <@ ${rootPath}::ltree
    order by path`)
  return result.rows
}

export async function hasChildren(db: OrgDb, tenantId: string, nodeId: string) {
  const result = await db.execute(sql`
    select 1 from org_nodes
    where tenant_id = ${tenantId} and parent_id = ${nodeId} limit 1`)
  return result.rows.length > 0
}

// child org types that would violate the rules if the node became newTypeId
export async function incompatibleChildTypes(
  db: OrgDb,
  tenantId: string,
  nodeId: string,
  newTypeId: string,
) {
  const result = await db.execute<{ org_type_id: string }>(
    incompatibleChildTypesQuery(tenantId, nodeId, newTypeId),
  )
  return result.rows.map((row) => row.org_type_id)
}

// the id is drawn from uuidv7() inside the statement so path and depth are
// written atomically with the row (no placeholder-path window)
export async function insertNode(
  tx: OrgTx,
  input: {
    tenantId: string
    parentId: string
    parentPath: string
    parentDepth: number
    orgTypeId: string
    code: string | null
    name: string
    sortOrder: number
  },
) {
  const result = await tx.execute<NodeRow>(sql`
    insert into org_nodes (id, tenant_id, parent_id, org_type_id, code, name, path, depth, sort_order)
    select v.id, ${input.tenantId}, ${input.parentId}, ${input.orgTypeId}, ${input.code},
      ${input.name}, (${input.parentPath} || '.' || replace(v.id::text, '-', ''))::ltree,
      ${input.parentDepth + 1}, ${input.sortOrder}
    from (select uuidv7() as id) v
    returning ${NODE_COLUMNS}`)
  return result.rows[0]!
}

export async function updateNodeFields(
  tx: OrgTx,
  tenantId: string,
  nodeId: string,
  fields: { name?: string; sortOrder?: number },
) {
  await tx.execute(sql`
    update org_nodes set
      name = coalesce(${fields.name ?? null}, name),
      sort_order = coalesce(${fields.sortOrder ?? null}, sort_order),
      updated_at = now()
    where tenant_id = ${tenantId} and id = ${nodeId}`)
}

export async function setNodeType(tx: OrgTx, tenantId: string, nodeId: string, typeId: string) {
  await tx.execute(setNodeTypeQuery(tenantId, nodeId, typeId))
}

// one statement rewrites the whole subtree: the moved node gets the exact
// new path and parent, descendants keep their tail below it, depth shifts
// uniformly. Runs under the tenant lock, so the path snapshot cannot go
// stale between validation and update.
export async function moveSubtree(
  tx: OrgTx,
  input: {
    tenantId: string
    nodeId: string
    newParentId: string
    oldPath: string
    newPath: string
    depthDelta: number
  },
) {
  await tx.execute(sql`
    update org_nodes set
      parent_id = case when id = ${input.nodeId}::uuid then ${input.newParentId}::uuid else parent_id end,
      path = case
        when id = ${input.nodeId}::uuid then ${input.newPath}::ltree
        else ${input.newPath}::ltree || subpath(path, nlevel(${input.oldPath}::ltree))
      end,
      depth = depth + ${input.depthDelta},
      updated_at = now()
    where tenant_id = ${input.tenantId} and path <@ ${input.oldPath}::ltree`)
}

export async function deleteNode(tx: OrgTx, tenantId: string, nodeId: string) {
  const result = await tx.execute(sql`
    delete from org_nodes where tenant_id = ${tenantId} and id = ${nodeId}`)
  return (result.rowCount ?? 0) > 0
}

export async function listTypes(db: OrgDb, tenantId: string) {
  const result = await db.execute<TypeRow>(sql`
    select id, code, name, sort_order from org_types
    where tenant_id = ${tenantId}
    order by sort_order, name`)
  return result.rows
}

export async function getType(db: OrgDb, tenantId: string, typeId: string) {
  const result = await db.execute<TypeRow>(sql`
    select id, code, name, sort_order from org_types
    where tenant_id = ${tenantId} and id = ${typeId}`)
  return result.rows[0]
}

export async function countTypes(db: OrgDb, tenantId: string, typeIds: readonly string[]) {
  const result = await db.execute<{ count: string }>(sql`
    select count(*) as count from org_types
    where tenant_id = ${tenantId}
      and id = any(string_to_array(${typeIds.join(',')}, ',')::uuid[])`)
  return Number(result.rows[0]?.count ?? 0)
}

export async function insertType(
  tx: OrgTx,
  input: { tenantId: string; code: string; name: string; sortOrder: number },
) {
  const result = await tx.execute<TypeRow>(sql`
    insert into org_types (tenant_id, code, name, sort_order)
    values (${input.tenantId}, ${input.code}, ${input.name}, ${input.sortOrder})
    returning id, code, name, sort_order`)
  return result.rows[0]!
}

export async function updateType(
  tx: OrgTx,
  tenantId: string,
  typeId: string,
  fields: { name?: string; sortOrder?: number },
) {
  await tx.execute(sql`
    update org_types set
      name = coalesce(${fields.name ?? null}, name),
      sort_order = coalesce(${fields.sortOrder ?? null}, sort_order),
      updated_at = now()
    where tenant_id = ${tenantId} and id = ${typeId}`)
}

export async function typeHasNodes(db: OrgDb, tenantId: string, typeId: string) {
  const result = await db.execute(sql`
    select 1 from org_nodes
    where tenant_id = ${tenantId} and org_type_id = ${typeId} limit 1`)
  return result.rows.length > 0
}

export async function typeHasRules(db: OrgDb, tenantId: string, typeId: string) {
  const result = await db.execute(sql`
    select 1 from org_type_rules
    where tenant_id = ${tenantId}
      and (parent_type_id = ${typeId} or child_type_id = ${typeId}) limit 1`)
  return result.rows.length > 0
}

export async function deleteType(tx: OrgTx, tenantId: string, typeId: string) {
  const result = await tx.execute(sql`
    delete from org_types where tenant_id = ${tenantId} and id = ${typeId}`)
  return (result.rowCount ?? 0) > 0
}

export async function listRules(db: OrgDb, tenantId: string) {
  const result = await db.execute<RuleRow>(sql`
    select r.parent_type_id, r.child_type_id
    from org_type_rules r
    join org_types p on p.tenant_id = r.tenant_id and p.id = r.parent_type_id
    join org_types c on c.tenant_id = r.tenant_id and c.id = r.child_type_id
    where r.tenant_id = ${tenantId}
    order by p.sort_order, p.name, c.sort_order, c.name`)
  return result.rows
}

export async function ruleExists(
  db: OrgDb,
  tenantId: string,
  parentTypeId: string,
  childTypeId: string,
) {
  const result = await db.execute(ruleExistsQuery(tenantId, parentTypeId, childTypeId))
  return result.rows.length > 0
}

// adding parent->child creates a cycle iff parent is already reachable from
// child by walking existing rules downward
export async function ruleWouldCycle(
  db: OrgDb,
  tenantId: string,
  parentTypeId: string,
  childTypeId: string,
) {
  const result = await db.execute(sql`
    with recursive reach as (
      select child_type_id from org_type_rules
      where tenant_id = ${tenantId} and parent_type_id = ${childTypeId}
      union
      select r.child_type_id from org_type_rules r
      join reach on r.parent_type_id = reach.child_type_id
      where r.tenant_id = ${tenantId}
    )
    select 1 from reach where child_type_id = ${parentTypeId} limit 1`)
  return result.rows.length > 0
}

export async function insertRule(
  tx: OrgTx,
  input: { tenantId: string; parentTypeId: string; childTypeId: string },
) {
  await tx.execute(sql`
    insert into org_type_rules (tenant_id, parent_type_id, child_type_id)
    values (${input.tenantId}, ${input.parentTypeId}, ${input.childTypeId})`)
}

// a rule is in use when an actual parent-child node pair depends on it
export async function ruleInUse(
  db: OrgDb,
  tenantId: string,
  parentTypeId: string,
  childTypeId: string,
) {
  const result = await db.execute(sql`
    select 1
    from org_nodes child
    join org_nodes parent on parent.tenant_id = child.tenant_id and parent.id = child.parent_id
    where child.tenant_id = ${tenantId}
      and parent.org_type_id = ${parentTypeId}
      and child.org_type_id = ${childTypeId}
    limit 1`)
  return result.rows.length > 0
}

export async function deleteRule(
  tx: OrgTx,
  tenantId: string,
  parentTypeId: string,
  childTypeId: string,
) {
  const result = await tx.execute(sql`
    delete from org_type_rules
    where tenant_id = ${tenantId}
      and parent_type_id = ${parentTypeId} and child_type_id = ${childTypeId}`)
  return (result.rowCount ?? 0) > 0
}
