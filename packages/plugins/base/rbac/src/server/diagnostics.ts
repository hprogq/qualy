import { Effect } from 'effect'
import { orgNodeExists, userExists } from './db.ts'

import type { ActivePermission } from '@qualy/rbac-contract'
import { explainRows } from './authorization.ts'
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
  const explain = Effect.fn('Rbac.diagnostics.explain')(function* (
    tenantId: string,
    userId: string,
    orgNodeId: string | undefined,
  ) {
    if (!(yield* userExists(tenantId, userId).pipe(Effect.orDie))) {
      return yield* new GrantUserNotFound()
    }
    if (orgNodeId !== undefined) {
      // an unknown node has no authority to explain, and answering as though
      // it did would disagree with canAt, which refuses it
      if (!(yield* orgNodeExists(tenantId, orgNodeId).pipe(Effect.orDie))) {
        return yield* new GrantNodeNotFound()
      }
    }
    const catalog = catalogOf()
    const found = yield* explainRows(tenantId, userId, orgNodeId).pipe(Effect.orDie)

    const out = new Map<
      string,
      { code: string; name: string; target: 'tenant' | 'org-node'; sources: PermissionSource[] }
    >()
    for (const row of found) {
      // the catalog is the authority on what a code means; a stored row that
      // drifted from its definition explains nothing
      const definition = catalog.get(row.code)
      if (!definition || definition.plugin !== row.plugin || definition.target !== row.targetKind) {
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
        roleId: row.roleId,
        roleCode: row.roleCode,
        grantId: row.grantId,
        target:
          row.orgNodeId === null
            ? { kind: 'tenant' }
            : {
                kind: 'org-node',
                orgNodeId: row.orgNodeId,
                orgNodeName: row.orgNodeName ?? '',
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
