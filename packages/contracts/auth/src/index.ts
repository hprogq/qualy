import { Context, Effect } from 'effect'

// The questions other plugins ask auth, as ports rather than a whole service.
//
// This package exists because of a defect rather than in anticipation of one.
// org calls iam.usersBlockingOrgType while importing nothing from
// @qualy/plugin-auth; the type only survived because both packages compiled in
// the same program, and org failed on its own until that was fixed. A service
// tag is a value, so under Effect the call would need a real import, and
// importing @qualy/plugin-auth from org would be a genuine cycle: auth
// value-imports org's schema for its foreign keys.
//
// Each tag carries one question and no database types. The current signature takes
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

/**
 * Where one person stands.
 *
 * A second tag rather than a second method on the one above, because these
 * are different questions asked by different plugins for different reasons:
 * `Placement` answers whether a KIND of person may stand somewhere, which is
 * a rule; this answers where a PARTICULAR person actually does, which is a
 * fact. Merging them would turn a port into a placement facade that grows
 * every time somebody needs one more thing about a user, and would make
 * every stub of the other tag carry a method its test never asks about.
 *
 * Null when nobody stands anywhere - a deleted unit detaches a deleted user
 * - and a caller reading an audience from it should read that as reaching
 * nothing rather than as reaching everything.
 */
export class UserPlacement extends Context.Service<
  UserPlacement,
  {
    readonly primaryNode: (
      tenantId: string,
      userId: string,
    ) => Effect.Effect<{ readonly nodeId: string } | null>
  }
>()('@qualy/auth-contract/UserPlacement') {}
