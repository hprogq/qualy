import { Effect } from 'effect'
import type { GrantTarget, Principal } from '@qualy/rbac-contract'
import { REACH_RANK, type Reach } from './authorization.ts'

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
// The rule that holds is the one Kubernetes settled on, applied where the
// power can actually grow. Defining a role - and, by the same measure,
// declaring that some office appoints it - may only use permissions the
// author already holds, with `iam.role.escalate` as the named, auditable
// exception. Granting a role to somebody ELSE compares nothing: whether that
// office is yours to fill is the appointment graph's question, and being
// obliged to personally hold a reviewer's every capability in order to
// appoint reviewers made every personnel role a copy of the duties it
// staffs. Granting a role to YOURSELF is the one move where a grant is an
// escalation, so there the comparison stays - with no exception, because an
// escape hatch on self-service is not an escape hatch, it is the hole.
//
// Everything here reads on the caller's transaction, so it sees the same role
// and grant rows the write is about to change.

export const ESCALATE = 'iam.role.escalate'

/** what the guards need to know about the actor, however it is answered */
export interface Authority {
  /** codes the actor holds tenant-wide, which is what a definition is measured against */
  readonly tenantWide: Effect.Effect<ReadonlySet<string>>
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
  const held = yield* authority.tenantWide
  const beyond = [...new Set(codes)].filter((code) => !held.has(code))
  if (beyond.length === 0) return
  if (held.has(ESCALATE)) return
  return yield* new RoleEscalationRefused({ permissions: beyond.sort() })
})

/**
 * Granting a role to oneself: the one grant that is an escalation.
 *
 * A self-grant may change what the holder IS - the business identity a
 * review chain's selector matches - but it must not change what they CAN DO:
 * the role's authority must fit inside what they already hold, at coverage
 * no wider than their own. No escape hatch, deliberately: any capability
 * that let its own holder wave this through would be self-service
 * escalation with extra steps.
 *
 * An office's authority is its permissions AND its outgoing appointment
 * edges. Measuring only the permissions collapsed the deliberately
 * non-transitive graph: every granter role carries the same
 * `iam.grant.manage` by construction, so promoting yourself from one
 * personnel office into the one it appoints compared as a no-op and handed
 * you every appointment that office makes. The edges are compared too, and
 * an edge that would be new refuses the grant under one unnamed marker: the
 * refusal travels to a client, and which offices exist is not a permission
 * code but an identity, which this payload does not carry.
 *
 * Third-party grants no longer come here at all. Whether an office is yours
 * to fill is the appointment graph's question (`role_grant_rules`), settled
 * when the edge is written.
 */
export const assertNoSelfEscalation = Effect.fn('Rbac.assertNoSelfEscalation')(function* (
  authority: Authority,
  role: {
    codes: readonly string[]
    allActive: boolean
    /** whether it appoints an office the actor cannot already appoint */
    gainsAppointments: boolean
  },
  target: GrantTarget,
) {
  const gained = role.gainsAppointments ? ['appointment-authority'] : []

  if (target.kind === 'tenant') {
    const held = yield* authority.tenantWide
    // an all-active role carries every active capability, so only someone who
    // already holds every active capability gains nothing by taking it
    const required = (role.allActive ? authority.activeCodes() : role.codes).filter(
      (code) => !held.has(code),
    )
    if (required.length === 0 && gained.length === 0) return
    return yield* new GrantEscalationRefused({
      permissions: [...required, ...gained].sort().slice(0, 20),
    })
  }

  const reach = yield* authority.reachAt(target.orgNodeId)
  const wanted = REACH_RANK[target.coverage as Reach]
  const short = role.codes.filter((code) => {
    const mine = reach.get(code)
    return mine === undefined || REACH_RANK[mine] < wanted
  })
  if (short.length === 0 && gained.length === 0 && !role.allActive) return
  return yield* new GrantEscalationRefused({
    permissions: [...(role.allActive ? ['*'] : short), ...gained].sort().slice(0, 20),
  })
})
