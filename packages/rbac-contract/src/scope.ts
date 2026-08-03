import { sql, type SQL } from 'drizzle-orm'
import type { AuthorizationScope } from './index.ts'

// How far a set of grants reaches, as a predicate a query can be filtered
// by. It lives here rather than in the rbac plugin because both sides of the
// authorization contract need it and the package graph must stay acyclic —
// and because two hand-written copies of "which nodes does this grant reach"
// is precisely the drift that once turned a self grant into a subtree read.
//
// A tenant role reaches everything. A self anchor covers exactly its node; a
// subtree anchor covers its whole ltree descendance. The anchor's own path
// is resolved inside the statement, so a caller holding a lock never needs a
// second connection.
export function scopeCoverage(scope: AuthorizationScope, nodeAlias: string): SQL {
  if (scope.tenantWide) return sql`true`
  const node = sql.raw(quoteIdentifier(nodeAlias))
  const selfIds = idList(scope.anchors.filter((anchor) => anchor.coverage === 'self'))
  const subtreeIds = idList(scope.anchors.filter((anchor) => anchor.coverage === 'subtree'))
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

// anchors come from rbac's own grant rows, but the values still reach the
// statement through sql.raw, so nothing but a uuid may pass
const idList = (anchors: readonly { orgNodeId: string }[]): string => {
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
