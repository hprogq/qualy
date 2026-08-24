import { defineEntity } from '@mikro-orm/core'
import { Tenant } from '@qualy/plugin-org/db'

// One table, append-only: what an administrator did, decided at write time
// and never rewritten. The application layer knows INSERT and SELECT; there
// is no update path and no delete path, and the admin api offers neither.

const p = defineEntity.properties

/**
 * One recorded operation.
 *
 * Actor and target are ids plus a display snapshot, deliberately without
 * foreign keys: an event outlives the user, the role and the batch it names,
 * and must not be deleted - or block deletion - because a row it refers to
 * went away. The tenant is the one real edge, because the history belongs to
 * the tenant and leaves with it.
 *
 * `target_id` is a string, not a uuid: a plugin may audit a resource whose
 * identity is a code or a path. `details` holds only what the action's
 * declared schema admitted, with the action code and version beside it so a
 * reader knows which shape explains the JSON.
 */
export const AuditEvent = defineEntity({
  name: 'AuditEvent',
  tableName: 'audit_events',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: () =>
      p
        .manyToOne(Tenant)
        .joinColumns('tenant_id')
        .referencedColumnNames('id')
        .foreignKeyName('audit_events_tenant_id_tenants_id_fkey')
        .deleteRule('cascade'),
    occurredAt: p.datetime().defaultRaw('now()'),

    actionCode: p.string().length(127),
    actionVersion: p.smallint(),

    actorKind: p.string().length(16),
    actorUserId: p.uuid().nullable(),
    actorLabel: p.string().length(255).nullable(),

    targetKind: p.string().length(127).nullable(),
    targetId: p.string().length(255).nullable(),
    targetLabel: p.string().length(255).nullable(),

    organizationId: p.uuid().nullable(),

    outcome: p.string().length(16),
    reasonCode: p.string().length(127).nullable(),

    details: p.json<Record<string, unknown>>(),

    source: p.string().length(16),

    requestId: p.uuid().nullable(),
    traceId: p.string().length(32).nullable(),
    sessionId: p.uuid().nullable(),

    clientIp: p.string().type('inet').nullable(),
    userAgent: p.text().nullable(),
  },
  checks: [
    {
      name: 'chk_audit_events_action_code_format',
      expression: `action_code ~ '^[a-z0-9-]+(\\.[a-z0-9-]+)+$'`,
    },
    {
      name: 'chk_audit_events_actor_kind',
      expression: `actor_kind IN ('user', 'system', 'service', 'anonymous')`,
    },
    {
      name: 'chk_audit_events_outcome',
      expression: `outcome IN ('success', 'denied', 'failure')`,
    },
    {
      name: 'chk_audit_events_source',
      expression: `source IN ('http', 'job', 'cli', 'system')`,
    },
  ],
  indexes: [
    // The screen's own order, and the keyset it pages by. All-ascending on
    // purpose: `order by occurred_at desc, id desc` under a tenant equality
    // is a backward scan of this index, while a mixed (desc, asc) column
    // pair - which the schema comparator would normalize a mixed
    // declaration into - can serve neither direction.
    {
      name: 'idx_audit_events_tenant_time',
      expression:
        'create index idx_audit_events_tenant_time on audit_events (tenant_id, occurred_at, id)',
    },
    {
      name: 'idx_audit_events_tenant_actor_time',
      expression:
        'create index idx_audit_events_tenant_actor_time on audit_events (tenant_id, actor_user_id, occurred_at desc)',
    },
    {
      name: 'idx_audit_events_tenant_action_time',
      expression:
        'create index idx_audit_events_tenant_action_time on audit_events (tenant_id, action_code, occurred_at desc)',
    },
    {
      name: 'idx_audit_events_tenant_target_time',
      expression:
        'create index idx_audit_events_tenant_target_time on audit_events (tenant_id, target_kind, target_id, occurred_at desc)',
    },
  ],
})

export const entities = [AuditEvent] as const
