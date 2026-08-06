import { Effect } from 'effect'
import type { GrantTarget, Principal } from '@qualy/rbac-contract'
import { REACH_RANK, type Reach } from '../queries.ts'

import { GrantEscalationRefused, RoleEscalationRefused } from './errors.ts'

// re-exported so a service and its failures still read as one module
export { GrantEscalationRefused, RoleEscalationRefused }

// Privilege escalation control.
//
// The per-permission "may this be granted" flag that used to live here never
// worked: it said which permissions were grantable in general, not who was
// allowed to grant them, so whoever could edit roles could put any grantable
// capability into one and hand it to themselves.
//
// The rule that holds is the one Kubernetes settled on. Defining a role may
// only use permissions the author already holds; granting a role may only hand
// out authority the granter already has, at coverage no wider than their own.
// Both have a named, auditable exception which only someone who already holds
// it can pass on.
//
// Everything here reads on the caller's transaction, so it sees the same role
// and grant rows the write is about to change.

export const ESCALATE = 'iam.role.escalate'
export const TENANT_BIND = 'iam.tenant-role.bind'
export const ORG_BIND = 'iam.org-role.bind'

/** what the guards need to know about the actor, however it is answered */
export interface Authority {
  /** codes the actor holds tenant-wide, which is what a definition is measured against */
  readonly tenantWide: () => Effect.Effect<ReadonlySet<string>>
  /** the strongest reach the actor has for each code at one node */
  readonly reachAt: (orgNodeId: string) => Effect.Effect<ReadonlyMap<string, Reach>>
  /** every code the catalog currently serves */
  readonly activeCodes: () => readonly string[]
  /** and their declarations, for the checks that need a code's target */
  readonly catalog: () => ReadonlyMap<string, { target: 'tenant' | 'org-node' }>
}

/**
 * Defining a role: the author may only name capabilities they already hold
 * tenant-wide.
 *
 * An org role is measured the same way even though it will be anchored later,
 * because the definition is reusable at every node: proving authority at one
 * college would not justify a role usable across the tenant.
 */
export const assertMayDefineRole = Effect.fn('Rbac.assertMayDefineRole')(function* (
  authority: Authority,
  codes: readonly string[],
) {
  if (codes.length === 0) return
  const held = yield* authority.tenantWide()
  const beyond = [...new Set(codes)].filter((code) => !held.has(code))
  if (beyond.length === 0) return
  if (held.has(ESCALATE)) return
  return yield* new RoleEscalationRefused({ permissions: beyond.sort() })
})

/**
 * Granting a role: the granter may only hand out authority they hold, at
 * coverage no wider than their own.
 *
 * Authority over the recipient is a different question, answered by the caller
 * before this runs: being allowed to edit someone's grants says nothing about
 * how much power may be put in them.
 */
export const assertMayGrantRole = Effect.fn('Rbac.assertMayGrantRole')(function* (
  authority: Authority,
  role: { codes: readonly string[]; allActive: boolean },
  target: GrantTarget,
) {
  const escape = target.kind === 'tenant' ? TENANT_BIND : ORG_BIND

  if (target.kind === 'tenant') {
    const held = yield* authority.tenantWide()
    // an all-active role carries every active capability, so only someone who
    // holds every active capability may hand it on
    const required = (role.allActive ? authority.activeCodes() : role.codes).filter(
      (code) => !held.has(code),
    )
    if (required.length === 0) return
    if (held.has(escape)) return
    return yield* new GrantEscalationRefused({ permissions: required.sort().slice(0, 20) })
  }

  const reach = yield* authority.reachAt(target.orgNodeId)
  const wanted = REACH_RANK[target.coverage as Reach]
  const short = role.codes.filter((code) => {
    const mine = reach.get(code)
    return mine === undefined || REACH_RANK[mine] < wanted
  })
  if (short.length === 0 && !role.allActive) return
  // The escape hatch answers to coverage too. Holding the bind at one node
  // alone is not authority to hand out a grant reaching its whole subtree,
  // or the weakest possible bind would be the strongest.
  const bindReach = reach.get(escape)
  if (bindReach !== undefined && REACH_RANK[bindReach] >= wanted) return
  return yield* new GrantEscalationRefused({
    permissions: (role.allActive ? ['*'] : short.sort()).slice(0, 20),
  })
})
