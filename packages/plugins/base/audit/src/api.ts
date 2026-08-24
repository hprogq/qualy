import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { BadRequest, pageOf, pageQuery, uiText } from '@qualy/api-kit/schema'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import { Authenticated } from '@qualy/plugin-auth/server/session-contract'

// The audit api, as definitions only. Paths are frozen.
//
// Read-only by construction: the trail is append-only and events are written
// by operations, so this group offers a list and the catalog that explains
// it, and nothing else - no update, no delete, ever.

const id = Schema.String.check(Schema.isUUID())

const outcome = Schema.Literals(['success', 'denied', 'failure'])

/** one recorded operation, as the log screen shows it */
const auditEvent = Schema.Struct({
  id: Schema.String,
  occurredAt: Schema.String,
  actionCode: Schema.String,
  actionVersion: Schema.Number,
  /** the declaring plugin's display name for the action; null for a code no loaded plugin declares */
  actionName: Schema.NullOr(uiText),
  actorKind: Schema.Literals(['user', 'system', 'service', 'anonymous']),
  actorUserId: Schema.NullOr(Schema.String),
  actorLabel: Schema.NullOr(Schema.String),
  targetKind: Schema.NullOr(Schema.String),
  targetId: Schema.NullOr(Schema.String),
  targetLabel: Schema.NullOr(Schema.String),
  organizationId: Schema.NullOr(Schema.String),
  outcome,
  reasonCode: Schema.NullOr(Schema.String),
  details: Schema.Record(Schema.String, Schema.Unknown),
  source: Schema.Literals(['http', 'job', 'cli', 'system']),
  requestId: Schema.NullOr(Schema.String),
  traceId: Schema.NullOr(Schema.String),
  clientIp: Schema.NullOr(Schema.String),
  userAgent: Schema.NullOr(Schema.String),
})

export const auditApiGroup = HttpApiGroup.make('audit')
  .add(
    HttpApiEndpoint.get('listAuditEvents', '/audit/events', {
      query: Schema.Struct({
        actionCode: Schema.optional(Schema.String.check(Schema.isMaxLength(127))),
        actorUserId: Schema.optional(id),
        outcome: Schema.optional(outcome),
        targetKind: Schema.optional(Schema.String.check(Schema.isMaxLength(127))),
        targetId: Schema.optional(Schema.String.check(Schema.isMaxLength(255))),
        /** inclusive lower and exclusive upper bounds, ISO timestamps */
        from: Schema.optional(Schema.String.check(Schema.isMaxLength(40))),
        to: Schema.optional(Schema.String.check(Schema.isMaxLength(40))),
        ...pageQuery,
      }),
      success: pageOf(auditEvent),
      error: [BadRequest, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // what the filter controls offer: every action this assembly can record,
    // named by the plugin that declared it
    HttpApiEndpoint.get('getAuditEventOptions', '/audit/event-options', {
      success: Schema.Struct({
        actions: Schema.Array(
          Schema.Struct({ code: Schema.String, name: uiText, plugin: Schema.String }),
        ),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
