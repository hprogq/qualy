// The access domain's own catalog. Permission modules are pure constants
// shared by the runtime registry (definePermissions) and the seed (row
// upsert before any plugin has booted) — one source, two consumers.
//
// The codes live under iam for the same reason the urls do: rbac is how
// authorization is implemented, and an administrator picking permissions in
// a list should read the product domain, not the mechanism.
import type { PermissionDefinition } from '@qualy/rbac-contract'

export const permissions = [
  {
    code: 'iam.role.read',
    name: '查看角色',
    target: 'tenant',
  },
  {
    code: 'iam.role.manage',
    name: '管理角色',
    target: 'tenant',
  },
  // Holding role.manage must not be a way to mint authority you lack: put a
  // permission in a role, grant yourself the role, and you have it. So a
  // role may only be given permissions its editor already holds — unless
  // they hold this, which is the deliberate, auditable exception.
  {
    code: 'iam.role.escalate',
    name: '定义超出自身权限的角色',
    description: '允许在角色中加入自己尚未持有的权限',
    target: 'tenant',
  },
  {
    code: 'iam.grant.read',
    name: '查看组织范围的角色授予',
    target: 'org-node',
  },
  {
    code: 'iam.grant.manage',
    name: '管理组织范围的角色授予',
    target: 'org-node',
  },
  // No bind escape hatches beside these any more (re-ruled 2026-08-20):
  // granting to somebody else stopped comparing permission sets - the
  // appointment graph is the whole of that authority - and a self-grant
  // must never escalate, with no permission able to say otherwise.
  {
    code: 'iam.tenant-grant.read',
    name: '查看租户级角色授予',
    target: 'tenant',
  },
  {
    code: 'iam.tenant-grant.manage',
    name: '管理租户级角色授予',
    target: 'tenant',
  },
  // The appointment graph is security policy, not role cosmetics: whoever
  // can redraw who-appoints-whom can route authority. Editing it is its own
  // capability, apart from editing role definitions.
  {
    code: 'iam.role.appointment.manage',
    name: '管理角色任命关系',
    description: '允许配置各角色可任命哪些角色',
    target: 'tenant',
  },
  // reading why someone holds what they hold names roles and grants, which
  // is more than an ordinary administrator needs
  {
    code: 'iam.authorization.inspect',
    name: '查看授权来源',
    target: 'tenant',
  },
] as const satisfies readonly PermissionDefinition[]
