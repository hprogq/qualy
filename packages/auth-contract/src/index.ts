import { Context, Effect } from 'effect'

// The one question org asks auth, as a port rather than a whole service.
//
// This package exists because of a defect rather than in anticipation of one.
// org calls iam.usersBlockingOrgType while importing nothing from
// @qualy/plugin-auth; the type only survived because both packages compiled in
// the same program, and org failed on its own until that was fixed. A service
// tag is a value, so under Effect the call would need a real import, and
// importing @qualy/plugin-auth from org would be a genuine cycle: auth
// value-imports org's schema for its foreign keys.
//
// It carries one method and no database types. The current signature takes
// auth's own transaction, which leaks auth's connection across a boundary
// whose whole purpose is to not do that. There is nothing to leak now: the
// connection travels in the fiber, so a call made inside the caller's
// transaction joins it.

/**
 * Whether retyping a node would strand the people standing on it.
 *
 * They do not move when the node changes under them, so a retype can strand
 * them exactly as a transfer would. The rule for what placement is legal is
 * auth's, so org asks rather than reimplementing it; that predicate has four
 * consumers and one implementation, which is the point.
 */
export class Placement extends Context.Service<
  Placement,
  {
    readonly usersBlockingOrgType: (
      tenantId: string,
      orgNodeId: string,
      orgTypeId: string,
    ) => Effect.Effect<number>
  }
>()('@qualy/auth-contract/Placement') {}
