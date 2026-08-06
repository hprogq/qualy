import { Effect } from 'effect'
import { Db, type ScopedKysely } from '@qualy/plugin-database/plugin'
import { sql } from 'kysely'
import { entities } from '../db/entities.ts'

// What org's queries may reach: its own tables and nothing else.
//
// org reads no other plugin's rows - it asks auth and rbac instead, through
// their services - so the closure is exactly this plugin's entities. The
// scope handle carries the ambient manager: a call made inside a transaction
// joins it by construction, which is what the explicit `em` parameter used
// to spell at every signature.

export const db = Db.scope([...entities] as const)

/** the builder fragment helpers receive, inside a query's callback */
type Db = ScopedKysely<readonly [...typeof entities]>

/**
 * Serializes every structural write of one tenant.
 *
 * rbac's assignment writes and auth's identity writes take the same lock, so
 * the three plugins cannot interleave a retype with a grant or a transfer.
 */
export const lockTenant = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('Tenant')
      .select(sql<number>`1`.as('locked'))
      .where('id', '=', tenantId)
      .forUpdate()
      .execute(),
  )

// --- org types ---

const typeColumns = ['id', 'code', 'name', 'sortOrder'] as const

export const listTypes = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('OrgType')
      .select(typeColumns)
      .where('tenantId', '=', tenantId)
      .orderBy('sortOrder')
      .orderBy('name')
      .execute(),
  )

export const oneType = (tenantId: string, typeId: string) =>
  db.query((k) =>
    k
      .selectFrom('OrgType')
      .select(typeColumns)
      .where('tenantId', '=', tenantId)
      .where('id', '=', typeId)
      .executeTakeFirst(),
  )

export const countTypes = (tenantId: string, typeIds: readonly string[]) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgType')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenantId', '=', tenantId)
        .where('id', 'in', typeIds)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.count ?? 0))

export const insertType = (input: {
  tenantId: string
  code: string
  name: string
  sortOrder: number
}) =>
  db.query((k) =>
    k.insertInto('OrgType').values(input).returning(typeColumns).executeTakeFirstOrThrow(),
  )

export const updateType = (
  tenantId: string,
  typeId: string,
  fields: { name?: string; sortOrder?: number },
) =>
  db.query((k) =>
    k
      .updateTable('OrgType')
      .set({
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(fields.sortOrder === undefined ? {} : { sortOrder: fields.sortOrder }),
        updatedAt: sql<Date>`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', typeId)
      .execute(),
  )

export const typeHasNodes = (tenantId: string, typeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgNode')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('orgTypeId', '=', typeId)
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const typeHasRules = (tenantId: string, typeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgTypeRule')
        .select('parentTypeId')
        .where('tenantId', '=', tenantId)
        .where((eb) => eb.or([eb('parentTypeId', '=', typeId), eb('childTypeId', '=', typeId)]))
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const deleteType = (tenantId: string, typeId: string) =>
  db.query((k) =>
    k.deleteFrom('OrgType').where('tenantId', '=', tenantId).where('id', '=', typeId).execute(),
  )

// --- the rules between them ---

export const listRules = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('OrgTypeRule as r')
      .innerJoin('OrgType as p', (join) =>
        join.onRef('p.tenantId', '=', 'r.tenantId').onRef('p.id', '=', 'r.parentTypeId'),
      )
      .innerJoin('OrgType as c', (join) =>
        join.onRef('c.tenantId', '=', 'r.tenantId').onRef('c.id', '=', 'r.childTypeId'),
      )
      .where('r.tenantId', '=', tenantId)
      .select(['r.parentTypeId', 'r.childTypeId'])
      .orderBy('p.sortOrder')
      .orderBy('p.name')
      .orderBy('c.sortOrder')
      .orderBy('c.name')
      .execute(),
  )

export const ruleExists = (tenantId: string, parentTypeId: string, childTypeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgTypeRule')
        .select('parentTypeId')
        .where('tenantId', '=', tenantId)
        .where('parentTypeId', '=', parentTypeId)
        .where('childTypeId', '=', childTypeId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/**
 * Whether adding parent -> child would close a cycle.
 *
 * It would exactly when parent is already reachable from child by walking
 * existing rules downward, so the rule graph stays a dag.
 */
export const ruleWouldCycle = (tenantId: string, parentTypeId: string, childTypeId: string) =>
  db
    .query((k) =>
      k
        .withRecursive('reach', (db) =>
          db
            .selectFrom('OrgTypeRule')
            .select('childTypeId')
            .where('tenantId', '=', tenantId)
            .where('parentTypeId', '=', childTypeId)
            .union((again) =>
              again
                .selectFrom('OrgTypeRule as r')
                .innerJoin('reach', 'reach.childTypeId', 'r.parentTypeId')
                .select('r.childTypeId')
                .where('r.tenantId', '=', tenantId),
            ),
        )
        .selectFrom('reach')
        .select('childTypeId')
        .where('childTypeId', '=', parentTypeId)
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const insertRule = (input: {
  tenantId: string
  parentTypeId: string
  childTypeId: string
}) => db.query((k) => k.insertInto('OrgTypeRule').values(input).execute())

/** a rule is in use when an actual parent-child node pair depends on it */
export const ruleInUse = (tenantId: string, parentTypeId: string, childTypeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgNode as child')
        .innerJoin('OrgNode as parent', (join) =>
          join
            .onRef('parent.tenantId', '=', 'child.tenantId')
            .onRef('parent.id', '=', 'child.parentId'),
        )
        .where('child.tenantId', '=', tenantId)
        .where('parent.orgTypeId', '=', parentTypeId)
        .where('child.orgTypeId', '=', childTypeId)
        .select('child.id')
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const deleteRule = (tenantId: string, parentTypeId: string, childTypeId: string) =>
  db.query((k) =>
    k
      .deleteFrom('OrgTypeRule')
      .where('tenantId', '=', tenantId)
      .where('parentTypeId', '=', parentTypeId)
      .where('childTypeId', '=', childTypeId)
      .execute(),
  )

// --- nodes ---

/**
 * What a node row carries.
 *
 * `path` is cast to text because ltree comes back as an opaque value
 * otherwise, and every caller compares it as a string.
 */
const nodeColumns = (k: Db) =>
  k
    .selectFrom('OrgNode')
    .select([
      'id',
      'parentId',
      'orgTypeId',
      'code',
      'name',
      'depth',
      'sortOrder',
      sql<string>`path::text`.as('path'),
    ])

export type NodeRow =
  Effect.Success<ReturnType<typeof rootNode>> extends infer R ? NonNullable<R> : never

export const oneNode = (tenantId: string, nodeId: string) =>
  db.query((k) =>
    nodeColumns(k).where('tenantId', '=', tenantId).where('id', '=', nodeId).executeTakeFirst(),
  )

export const rootNode = (tenantId: string) =>
  db.query((k) =>
    nodeColumns(k)
      .where('tenantId', '=', tenantId)
      .where('parentId', 'is', null)
      .executeTakeFirst(),
  )

export const nodesById = (tenantId: string, nodeIds: readonly string[]) =>
  db.query((k) => {
    if (nodeIds.length === 0) return Promise.resolve([])
    return nodeColumns(k).where('tenantId', '=', tenantId).where('id', 'in', nodeIds).execute()
  })

export const subtree = (tenantId: string, rootPath: string) =>
  db.query((k) =>
    nodeColumns(k)
      .where('tenantId', '=', tenantId)
      .where((eb) => sql<boolean>`${eb.ref('path')} <@ ${rootPath}::ltree`)
      .orderBy('path')
      .execute(),
  )

/** children whose own type the new parent type would not permit */
export const incompatibleChildTypes = (tenantId: string, nodeId: string, newTypeId: string) =>
  db.query((k) =>
    k
      .selectFrom('OrgNode as child')
      .where('child.tenantId', '=', tenantId)
      .where('child.parentId', '=', nodeId)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('OrgTypeRule as r')
              .select('r.parentTypeId')
              .where('r.tenantId', '=', tenantId)
              .where('r.parentTypeId', '=', newTypeId)
              .whereRef('r.childTypeId', '=', 'child.orgTypeId'),
          ),
        ),
      )
      .select('child.orgTypeId')
      .distinct()
      .execute(),
  )

export const setNodeType = (tenantId: string, nodeId: string, typeId: string) =>
  db.query((k) =>
    k
      .updateTable('OrgNode')
      .set({ orgTypeId: typeId, updatedAt: sql<Date>`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', nodeId)
      .execute(),
  )

export const hasChildren = (tenantId: string, nodeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgNode')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('parentId', '=', nodeId)
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const updateNodeFields = (
  tenantId: string,
  nodeId: string,
  fields: { name?: string; sortOrder?: number },
) =>
  db.query((k) =>
    k
      .updateTable('OrgNode')
      .set({
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(fields.sortOrder === undefined ? {} : { sortOrder: fields.sortOrder }),
        updatedAt: sql<Date>`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', nodeId)
      .execute(),
  )

export const deleteNode = (tenantId: string, nodeId: string) =>
  db.query((k) =>
    k.deleteFrom('OrgNode').where('tenantId', '=', tenantId).where('id', '=', nodeId).execute(),
  )

/**
 * The snapshot a read projection runs in.
 *
 * Anchors and the tree have to resolve against the same view of the database:
 * without it a concurrent move can tear the response, and a grant revoked
 * mid-read can still contribute nodes. Postgres requires it as the
 * transaction's first statement, which is why it is a statement rather than an
 * option.
 */
export const readSnapshot = () =>
  db.query((k) => sql`set transaction isolation level repeatable read, read only`.execute(k))

/**
 * A new node, with its path written atomically with the row.
 *
 * The id comes from uuidv7() inside the statement so there is no window where
 * the row exists with a placeholder path. Written out rather than built,
 * because the path is derived from the id the same statement generates.
 */
export const insertNode = (input: {
  tenantId: string
  parentId: string
  parentPath: string
  parentDepth: number
  orgTypeId: string
  code: string | null
  name: string
  sortOrder: number
}) =>
  db.query(async (k) => {
    const { rows } = await sql<NodeRow>`
      insert into org_nodes (id, tenant_id, parent_id, org_type_id, code, name, path, depth, sort_order)
      select v.id, ${input.tenantId}, ${input.parentId}, ${input.orgTypeId}, ${input.code},
        ${input.name}, (${input.parentPath} || '.' || replace(v.id::text, '-', ''))::ltree,
        ${input.parentDepth + 1}, ${input.sortOrder}
      from (select uuidv7() as id) v
      returning id, parent_id as "parentId", org_type_id as "orgTypeId", code, name,
        path::text as path, depth, sort_order as "sortOrder"`.execute(k)
    return rows[0]!
  })

/**
 * The whole subtree relocated by one statement.
 *
 * The moved node takes the exact new path and parent, descendants keep their
 * tail below it, and depth shifts uniformly. Runs under the tenant lock, so
 * the path snapshot cannot go stale between validation and update.
 */
export const moveSubtree = (input: {
  tenantId: string
  nodeId: string
  newParentId: string
  oldPath: string
  newPath: string
  depthDelta: number
}) =>
  db.query((k) =>
    sql`
      update org_nodes set
        parent_id = case when id = ${input.nodeId}::uuid then ${input.newParentId}::uuid
          else parent_id end,
        path = case
          when id = ${input.nodeId}::uuid then ${input.newPath}::ltree
          else ${input.newPath}::ltree || subpath(path, nlevel(${input.oldPath}::ltree))
        end,
        depth = depth + ${input.depthDelta},
        updated_at = now()
      where tenant_id = ${input.tenantId} and path <@ ${input.oldPath}::ltree`.execute(k),
  )
