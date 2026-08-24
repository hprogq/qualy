import { Context, type Effect } from 'effect'
import type { AuditAction, AuditDetailsSchema } from './action.ts'
import type { AuditActor, AuditOutcome, AuditSource, AuditTargetRef } from './index.ts'

// The Effect side of this contract, behind its own subpath like rbac's: a
// service tag is a value, and importing it from @qualy/plugin-audit would put
// the implementation above its consumers - auth, rbac and org all record.

/** one declared action with the plugin that declared it */
export interface RegisteredAuditAction {
  readonly plugin: string
  readonly action: AuditAction
}

/**
 * Every audit action this assembly can record, complete before any layer
 * builds.
 *
 * A prepare-phase value like the permission catalog: contributions are
 * collected from the descriptors and compiled before a single service exists,
 * so the writer is handed a finished registry and is downstream of nobody.
 */
export class AuditActionCatalog extends Context.Service<
  AuditActionCatalog,
  readonly RegisteredAuditAction[]
>()('@qualy/audit-contract/AuditActionCatalog') {}

/**
 * One operation, as the caller states it.
 *
 * The actor is passed in rather than resolved here - the writer must not
 * become downstream of auth to write - and request correlation (request id,
 * trace, session, client address) is NOT here at all: the writer reads it
 * from the request context itself, so a caller can neither forget it nor
 * forge it.
 */
export interface AuditRecordInput<Details> {
  readonly tenantId: string
  readonly actor: AuditActor
  /** its kind comes from the action; only the instance is per-event */
  readonly target?: AuditTargetRef
  /** the org node the operation happened under, when there is one */
  readonly organizationId?: string
  /** defaults to success; a refusal worth recording says so */
  readonly outcome?: AuditOutcome
  readonly reasonCode?: string
  /** defaults to http under a request, system otherwise */
  readonly source?: AuditSource
  readonly details: Details
}

/**
 * The writer, as everything that records sees it.
 *
 * `record` has no error channel on purpose. Inside a transaction it writes on
 * the caller's connection - the ambient manager joins an open transaction by
 * construction - and a failure to write is a defect that aborts the whole
 * commit: an operation declared auditable either commits with its event or
 * not at all. An unregistered action or nonconforming details is the same
 * kind of defect, a programming error rather than an outcome.
 */
export interface AuditShape {
  readonly record: <Details extends AuditDetailsSchema>(
    action: AuditAction<Details>,
    input: AuditRecordInput<Details['Type']>,
  ) => Effect.Effect<void>
}

export class Audit extends Context.Service<Audit, AuditShape>()('@qualy/audit-contract/Audit') {}
