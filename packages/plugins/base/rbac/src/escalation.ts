import { sql } from 'drizzle-orm'
import type { GrantTarget, Principal, RbacDbHandle } from '@qualy/rbac-contract'
import { REACH_RANK, type Authorization, type Reach } from './authorization.ts'
import { accessErrors } from './errors.ts'

// Privilege escalation control.
//
// Removing the per-permission "may this be granted to a role" flag removes a
// guard that never worked anyway: it said which permissions were grantable
// in general, not who was allowed to grant them. Whoever could edit roles
// could put any grantable capability into one and hand it to themselves.
//
// The rule that actually holds is the one Kubernetes settled on. Defining a
// role may only use permissions the author already holds; granting a role
// may only hand out authority the granter already has, at coverage no wider
// than their own. Both have a named, auditable exception — escalate and
// bind — which only someone who already holds them can hand out.
//
// Everything here runs on the caller's transaction: it reads the same role
// and grant rows the write is about to change.

export const ESCALATE = 'iam.role.escalate'
export const TENANT_BIND = 'iam.tenant-role.bind'
export const ORG_BIND = 'iam.org-role.bind'

// The permissions a role carries, as codes. An all-active role carries
// everything, which is why it can never be defined by this api and can only
// be granted by someone who holds everything.
export async function rolePermissionCodes(
  handle: RbacDbHandle,
  tenantId: string,
  roleId: string,
): Promise<{ codes: string[]; allActive: boolean }> {
  const role = (
    await handle.execute(sql`
      select permission_mode from roles where tenant_id = ${tenantId} and id = ${roleId}`)
  ).rows[0] as { permission_mode: string } | undefined
  if (!role) throw accessErrors.create('ROLE_NOT_FOUND')
  if (role.permission_mode === 'all-active') return { codes: [], allActive: true }
  const rows = (
    await handle.execute(sql`
      select p.code from role_permissions rp
      join permissions p on p.id = rp.permission_id
      where rp.tenant_id = ${tenantId} and rp.role_id = ${roleId}`)
  ).rows as { code: string }[]
  return { codes: rows.map((row) => row.code), allActive: false }
}

// Defining a role: the author may only name capabilities they already hold
// tenant-wide. An org role is checked the same way even though it will be
// anchored later, because the definition is reusable at every node — proving
// authority at one college would not justify a role usable across the tenant.
export async function assertMayDefineRole(
  authorization: Authorization,
  actor: Principal | undefined,
  codes: readonly string[],
  handle: RbacDbHandle,
): Promise<void> {
  if (!actor || codes.length === 0) return
  const held = await authorization.effectiveCodes(actor, undefined, handle)
  const beyond = [...new Set(codes)].filter((code) => !held.has(code))
  if (beyond.length === 0) return
  if (held.has(ESCALATE)) return
  throw accessErrors.create('ROLE_ESCALATION_REFUSED', { permissions: beyond.sort() })
}

// Granting a role: the granter may only hand out authority they hold, at
// coverage no wider than their own. Authority over the recipient is a
// different question, answered by the caller before this runs — being
// allowed to edit someone's grants says nothing about how much power you may
// put in them.
export async function assertMayGrantRole(
  authorization: Authorization,
  actor: Principal | undefined,
  tenantId: string,
  roleId: string,
  target: GrantTarget,
  handle: RbacDbHandle,
): Promise<void> {
  if (!actor) return
  const { codes, allActive } = await rolePermissionCodes(handle, tenantId, roleId)
  const escape = target.kind === 'tenant' ? TENANT_BIND : ORG_BIND

  if (target.kind === 'tenant') {
    const held = await authorization.effectiveCodes(actor, undefined, handle)
    // an all-active role carries every active capability, so only someone
    // who holds every active capability may hand it on
    const required = (allActive ? authorization.activeCodes() : codes).filter(
      (code) => !held.has(code),
    )
    if (required.length === 0) return
    if (held.has(escape)) return
    throw accessErrors.create('GRANT_ESCALATION_REFUSED', {
      permissions: required.sort().slice(0, 20),
    })
  }

  const reach = await authorization.reachAt(actor, target.orgNodeId, handle)
  const wanted = REACH_RANK[target.coverage as Reach]
  const short = codes.filter((code) => {
    const mine = reach.get(code)
    return mine === undefined || REACH_RANK[mine] < wanted
  })
  if (short.length === 0 && !allActive) return
  // The escape hatch answers to coverage too. Holding org-role.bind at one
  // node alone is not authority to hand out a grant reaching its whole
  // subtree — otherwise the weakest possible bind would be the strongest.
  const bindReach = reach.get(escape)
  if (bindReach !== undefined && REACH_RANK[bindReach] >= wanted) return
  throw accessErrors.create('GRANT_ESCALATION_REFUSED', {
    permissions: (allActive ? ['*'] : short.sort()).slice(0, 20),
  })
}
