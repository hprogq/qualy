import { sql, type SQL } from 'drizzle-orm'
import type { AuthorizationAnchor } from './index.ts'

// What a set of authorization anchors covers, as a predicate a query can be
// filtered by. It lives here rather than in the rbac plugin because both
// sides of the authorization contract need it and the package graph must
// stay acyclic — and because two hand-written copies of "which nodes does
// this grant reach" is precisely the kind of drift that turns a self grant
// into a subtree read.
//
// A self anchor covers exactly its node; a subtree anchor covers its whole
// ltree descendance. The anchor's own path is resolved inside the statement,
// so a caller holding a lock never needs a second connection.
export function anchorCoverage(
  anchors: readonly AuthorizationAnchor[],
  nodeAlias: string,
): SQL {
  const node = sql.raw(quoteIdentifier(nodeAlias))
  const selfIds = idList(anchors.filter((anchor) => anchor.scope === 'self'))
  const subtreeIds = idList(anchors.filter((anchor) => anchor.scope === 'subtree'))
  if (selfIds === EMPTY && subtreeIds === EMPTY) return sql`false`
  return sql`exists (
    select 1 from org_nodes qualy_anchor
    where qualy_anchor.tenant_id = ${node}.tenant_id
      and (
        (qualy_anchor.id = any(${sql.raw(selfIds)}) and ${node}.id = qualy_anchor.id)
        or (qualy_anchor.id = any(${sql.raw(subtreeIds)})
            and ${node}.path <@ qualy_anchor.path)
      )
  )`
}

const EMPTY = `'{}'::uuid[]`

// anchors come from rbac's own assignment rows, but the values still reach
// the statement through sql.raw, so nothing but a uuid may pass
const idList = (anchors: readonly AuthorizationAnchor[]): string => {
  const ids = [...new Set(anchors.map((anchor) => anchor.orgNodeId))]
  for (const id of ids) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error(`authorization anchor ${id} is not a uuid`)
    }
  }
  return ids.length === 0 ? EMPTY : `array['${ids.join("','")}']::uuid[]`
}

const quoteIdentifier = (alias: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`invalid table alias ${alias}`)
  return alias
}
