import { Context, Data, type Effect } from 'effect'
import type { Principal } from '@qualy/rbac-contract'
import type { AccessDenied } from '@qualy/rbac-contract/effect'
import type { OrgNodeRef, OrgTypeRef, OrgTypeRuleRef } from './index.ts'

// The questions a neighbour asks org, as ports rather than a whole service.
//
// A bulk provisioning of people has to materialise the units they stand in,
// and org owns the grammar those units follow. This is the door org opens
// for that: reads of the grammar and the tree, one child created under a
// parent the caller manages inside the caller's own transaction, and one
// leaf taken away when nothing uses it. Nothing here moves or retypes a
// node; those stay org's own operations.

/** a child could not be created, in org's own word for why */
export class OrgNodeRefused extends Data.TaggedError('OrgNodeRefused')<{
  readonly reason: 'parent-missing' | 'type-missing' | 'rule' | 'duplicate' | 'other'
}> {}

export class OrgProvisioning extends Context.Service<
  OrgProvisioning,
  {
    readonly rootNode: (tenantId: string) => Effect.Effect<OrgNodeRef | null>
    readonly nodesById: (tenantId: string, ids: readonly string[]) => Effect.Effect<readonly OrgNodeRef[]>
    /** the child of a parent that bears exactly this name, since names are unique under a parent */
    readonly childNamed: (
      tenantId: string,
      parentId: string,
      name: string,
    ) => Effect.Effect<OrgNodeRef | null>
    readonly types: (tenantId: string) => Effect.Effect<readonly OrgTypeRef[]>
    readonly rules: (tenantId: string) => Effect.Effect<readonly OrgTypeRuleRef[]>
    /**
     * One child under a parent the caller may manage, on the caller's own
     * transaction and under the tenant lock the caller already holds.
     * Audited like any other creation.
     */
    readonly createChild: (
      tenantId: string,
      input: { readonly parentId: string; readonly orgTypeId: string; readonly name: string },
      as: Principal,
    ) => Effect.Effect<OrgNodeRef, AccessDenied | OrgNodeRefused>
    /**
     * A leaf nobody uses, taken away in its own transaction; a node with
     * children or with rows pointing at it stays, and the answer says which.
     */
    readonly deleteUnused: (
      tenantId: string,
      nodeId: string,
      as: Principal,
    ) => Effect.Effect<'deleted' | 'has-children' | 'in-use' | 'missing', AccessDenied>
  }
>()('@qualy/org-contract/OrgProvisioning') {}
