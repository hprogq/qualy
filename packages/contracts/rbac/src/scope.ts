import { sql, type Expression, type RawBuilder } from 'kysely'
import type { AuthorizationScope } from './index.ts'

// How far a set of grants reaches, as a predicate a query can be filtered
// by. It lives here rather than in the rbac plugin because both sides of the
// authorization contract need it and the package graph must stay acyclic -
// and because two hand-written copies of "which nodes does this grant reach"
// is precisely the drift that once turned a self grant into a subtree read.
//
// A tenant role reaches everything. A self anchor covers exactly its node; a
// subtree anchor covers its whole ltree descendance. The anchor's own path
// is resolved inside the statement, so a caller holding a lock never needs a
// second connection.

/**
 * The org_nodes columns the predicate reads, wherever the caller aliased them.
 *
 * References rather than an alias string: the caller passes `eb.ref('n.path')`,
 * so a query that renamed its join, or never joined org_nodes at all, stops
 * compiling instead of describing a table that is not there.
 *
 * Nullable because org_nodes is outer-joined where a grant may be tenant-wide.
 * Such a row has no node for this to decide, and the caller says so with a
 * case rather than by handing the predicate a node that is not there.
 */
export interface OrgNodeRef {
  readonly id: Expression<string | null>
  readonly tenantId: Expression<string | null>
  readonly path: Expression<string | null>
}

export function scopeCoverage(scope: AuthorizationScope, node: OrgNodeRef): RawBuilder<boolean> {
  if (scope.tenantWide) return sql<boolean>`true`
  const self = anchorIds(scope, 'self')
  const subtree = anchorIds(scope, 'subtree')
  if (self.length === 0 && subtree.length === 0) return sql<boolean>`false`
  return sql<boolean>`exists (
    select 1 from org_nodes qualy_anchor
    where qualy_anchor.tenant_id = ${node.tenantId}
      and (
        (qualy_anchor.id = any(${self}::uuid[]) and ${node.id} = qualy_anchor.id)
        or (qualy_anchor.id = any(${subtree}::uuid[])
            and ${node.path} <@ qualy_anchor.path)
      )
  )`
}

// The ids are bound now, not spelled into the statement. They used to be
// interpolated because `= any()` wanted an array literal, which is why this
// file also carried a uuid check: that was an injection guard rather than a
// domain rule, and binding them removes the thing it guarded against.
const anchorIds = (scope: AuthorizationScope, coverage: 'self' | 'subtree'): string[] => [
  ...new Set(
    scope.anchors.filter((anchor) => anchor.coverage === coverage).map((a) => a.orgNodeId),
  ),
]
