import { Effect } from 'effect'
import { LegacySql } from '@qualy/plugin-database/server'
import type { ActivePermission } from '@qualy/rbac-contract'
import { explainRowsQuery, orgNodeExistsQuery, userExistsQuery } from '../queries.ts'
import { GrantNodeNotFound, GrantUserNotFound } from './grants.ts'
import { PermissionNotFound } from './roles.ts'

import { AccessTargetRequired } from './errors.ts'

// re-exported so a service and its failures still read as one module
export { AccessTargetRequired }

// Why someone holds what they hold.
//
// Answering "allowed?" is the easy half; the reason is what makes a wrong
// answer fixable, and what an audit needs. Every source is a grant, so there
// is no second channel to explain.
//
// The explanation runs the same reach predicate the decision runs, from
// queries.ts. An explanation that disagrees with the answer is worse than no
// explanation, because it sends somebody looking in the wrong place.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

export interface PermissionSource {
  readonly roleId: string
  readonly roleCode: string
  readonly grantId: string
  readonly target:
    | { readonly kind: 'tenant' }
    | {
        readonly kind: 'org-node'
        readonly orgNodeId: string
        readonly orgNodeName: string
        readonly coverage: 'self' | 'subtree'
      }
}

export interface EffectivePermission {
  readonly code: string
  readonly name: string
  readonly target: 'tenant' | 'org-node'
  readonly sources: readonly PermissionSource[]
}

export const make = Effect.fn('Rbac.diagnostics.make')(function* (
  catalogOf: () => ReadonlyMap<string, ActivePermission>,
) {
  const database = yield* LegacySql

  const explain = Effect.fn('Rbac.diagnostics.explain')(function* (
    tenantId: string,
    userId: string,
    orgNodeId: string | undefined,
  ) {
    const user = rows(yield* database.execute(userExistsQuery(tenantId, userId)).pipe(Effect.orDie))
    if (user.length === 0) return yield* new GrantUserNotFound()
    if (orgNodeId !== undefined) {
      const node = rows(
        yield* database.execute(orgNodeExistsQuery(tenantId, orgNodeId)).pipe(Effect.orDie),
      )
      // an unknown node has no authority to explain, and answering as though
      // it did would disagree with canAt, which refuses it
      if (node.length === 0) return yield* new GrantNodeNotFound()
    }
    const catalog = catalogOf()
    const found = yield* database
      .execute(explainRowsQuery(tenantId, userId, orgNodeId))
      .pipe(Effect.orDie)

    const out = new Map<
      string,
      { code: string; name: string; target: 'tenant' | 'org-node'; sources: PermissionSource[] }
    >()
    for (const row of rows<{
      code: string
      plugin: string
      target_kind: 'tenant' | 'org-node'
      role_id: string
      role_code: string
      grant_id: string
      org_node_id: string | null
      org_node_name: string | null
      coverage: 'self' | 'subtree' | null
    }>(found)) {
      // the catalog is the authority on what a code means; a stored row that
      // drifted from its definition explains nothing
      const definition = catalog.get(row.code)
      if (
        !definition ||
        definition.plugin !== row.plugin ||
        definition.target !== row.target_kind
      ) {
        continue
      }
      // a tenant capability only ever arrives through a tenant role
      if (definition.target === 'tenant' && row.coverage !== null) continue
      let entry = out.get(row.code)
      if (!entry) {
        entry = {
          code: definition.code,
          name: definition.name,
          target: definition.target,
          sources: [],
        }
        out.set(row.code, entry)
      }
      entry.sources.push({
        roleId: row.role_id,
        roleCode: row.role_code,
        grantId: row.grant_id,
        target:
          row.org_node_id === null
            ? { kind: 'tenant' }
            : {
                kind: 'org-node',
                orgNodeId: row.org_node_id,
                orgNodeName: row.org_node_name ?? '',
                coverage: row.coverage ?? 'self',
              },
      })
    }
    return [...out.values()] as readonly EffectivePermission[]
  })

  return {
    explain,

    /**
     * One question, answered with its reason attached.
     *
     * It reuses the explanation rather than asking the decision separately:
     * two paths would agree until one was edited, and this endpoint exists
     * precisely to be trusted about why.
     */
    evaluate: Effect.fn('Rbac.diagnostics.evaluate')(function* (
      tenantId: string,
      request: { userId: string; permissionCode: string; orgNodeId?: string },
    ) {
      const definition = catalogOf().get(request.permissionCode)
      if (!definition) {
        return yield* new PermissionNotFound({ permissions: [request.permissionCode] })
      }
      if (definition.target === 'org-node' && request.orgNodeId === undefined) {
        return yield* new AccessTargetRequired()
      }
      const explained = yield* explain(tenantId, request.userId, request.orgNodeId)
      const entry = explained.find((row) => row.code === request.permissionCode)
      return {
        allowed: entry !== undefined,
        target: definition.target,
        sources: entry?.sources ?? [],
      }
    }),
  }
})
