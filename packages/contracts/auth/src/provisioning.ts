import { Context, Data, type Effect } from 'effect'
import type { Principal } from '@qualy/rbac-contract'
import type { AccessDenied, LastAdministrator } from '@qualy/rbac-contract/effect'

// The questions a bulk provisioning asks auth, as a port.
//
// A directory import creates hundreds of people in one transaction and
// takes them away again in one act. Calling the single-user service once a
// row would open the tenant lock and the audit trail a few hundred times;
// this port runs on the caller's transaction, judges every row the way the
// single-user path judges one, and writes every event the single-user
// path writes. What it refuses to do is decide who may be created where -
// that is asked of rbac per node, exactly as a single creation is.

/** one person to create */
export interface ProvisionedUserInput {
  readonly displayName: string
  readonly businessNo: string
  readonly userTypeId: string
  readonly primaryOrgNodeId: string
}

/** a person already on the books, as an importer needs to know them */
export interface ExistingUserRef {
  readonly id: string
  readonly businessNo: string
  readonly displayName: string
  readonly userTypeId: string | null
  readonly primaryOrgNodeId: string | null
  readonly enabled: boolean
  readonly deleted: boolean
}

export interface UserTypeRef {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly isSystem: boolean
}

/** a row the single-user path would have refused, named by its position */
export class UserProvisioningRefused extends Data.TaggedError('UserProvisioningRefused')<{
  readonly index: number
  readonly reason: 'type-missing' | 'type-disabled' | 'type-system' | 'node-missing' | 'placement' | 'conflict'
}> {}

export class UserProvisioning extends Context.Service<
  UserProvisioning,
  {
    /** the people already carrying any of these identifiers, deleted ones included */
    readonly byBusinessNo: (
      tenantId: string,
      businessNos: readonly string[],
    ) => Effect.Effect<readonly ExistingUserRef[]>
    readonly userType: (tenantId: string, userTypeId: string) => Effect.Effect<UserTypeRef | null>
    /**
     * Whether this kind of person may stand at a unit of this type, asked
     * of the type rather than of a node: an import judges rows before the
     * units they stand in exist. Undefined when the user type is unknown.
     */
    readonly placementAllowedAtType: (
      tenantId: string,
      userTypeId: string,
      orgTypeId: string,
    ) => Effect.Effect<boolean | undefined>
    /**
     * Every row created, on the caller's transaction and under the tenant
     * lock the caller holds. Authority is proved once per distinct node,
     * every row is judged before any is written, and every creation is
     * audited. A refusal names the row and rolls the caller back.
     */
    readonly createUsers: (
      tenantId: string,
      rows: readonly ProvisionedUserInput[],
      as: Principal,
    ) => Effect.Effect<
      readonly { readonly index: number; readonly id: string }[],
      AccessDenied | UserProvisioningRefused
    >
    /**
     * Every living person among these ids taken through disabled to deleted,
     * with the single-user path's own consequences: grants revoked, ways in
     * withdrawn, sessions ended, each step audited. Somebody already deleted
     * is skipped; a system account is skipped too. The tenant must still
     * have an administrator afterwards.
     */
    readonly retireUsers: (
      tenantId: string,
      userIds: readonly string[],
      as: Principal,
    ) => Effect.Effect<
      { readonly retired: number; readonly skipped: number },
      AccessDenied | LastAdministrator
    >
  }
>()('@qualy/auth-contract/UserProvisioning') {}
