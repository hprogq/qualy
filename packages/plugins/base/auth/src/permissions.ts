// The auth plugin's permission catalog; shape is validated where it meets
// rbac.definePermissions, and the seed upserts the same rows by code.
//
// There is deliberately no "may enter the portal" capability. Whether a
// signed-in person reaches the shell is authentication state — an enabled
// user with an enabled type and a live session — and pages say so with
// AUTHENTICATED visibility. Modelling it as a permission meant every user
// type needed a role just to carry it, which is most of why user types
// started carrying roles at all.
import type { PermissionDefinition } from '@qualy/rbac-contract'

export const permissions = [
  {
    code: 'auth.user-type.read',
    name: '查看用户类型',
    target: 'tenant',
  },
  {
    code: 'auth.user-type.manage',
    name: '管理用户类型',
    target: 'tenant',
  },
  {
    code: 'auth.user.read',
    name: '查看用户',
    target: 'org-node',
  },
  {
    code: 'auth.user.manage',
    name: '管理用户',
    target: 'org-node',
  },
] as const satisfies readonly PermissionDefinition[]
