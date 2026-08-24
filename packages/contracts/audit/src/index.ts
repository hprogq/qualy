// The audit contract: plugins that record audit events depend on this package
// instead of the audit implementation, which keeps the package graph acyclic -
// the implementation depends on org's schema for tenancy, and auth, rbac and
// org all record events.
//
// The root carries plain types only. The action constructor, the service tags
// and the descriptor feature each live behind their own subpath, because they
// pull in `effect` and the kernel, and this root stays importable anywhere.

/**
 * Who performed an operation.
 *
 * `user` is a person acting through a session; `system` is the process itself
 * (seed, startup mirroring); `service` is another machine acting through a
 * credential; `anonymous` is an unauthenticated caller - a failed sign-in has
 * one. The label is a display snapshot taken when the event was written, so
 * history stays readable after the row it names is gone; the id is the
 * identity.
 */
export type AuditActorKind = 'user' | 'system' | 'service' | 'anonymous'

export interface AuditActor {
  readonly kind: AuditActorKind
  readonly userId?: string
  readonly label?: string
}

/**
 * What the thing acted on was, as ids and a display snapshot.
 *
 * The id is a string rather than a uuid on purpose: a plugin may audit a
 * resource whose identity is a code or a path. What KIND of thing it was is
 * declared on the action, not chosen per event.
 */
export interface AuditTargetRef {
  readonly id: string
  readonly label?: string
}

/** how the operation ended; a refusal is an outcome, not an absence of event */
export type AuditOutcome = 'success' | 'denied' | 'failure'

/** which kind of caller the operation came in through */
export type AuditSource = 'http' | 'job' | 'cli' | 'system'
