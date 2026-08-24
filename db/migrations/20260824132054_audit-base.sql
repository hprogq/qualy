create table "audit_events" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "occurred_at" timestamptz(6) not null default now(), "action_code" varchar(127) not null, "action_version" int2 not null, "actor_kind" varchar(16) not null, "actor_user_id" uuid null, "actor_label" varchar(255) null, "target_kind" varchar(127) null, "target_id" varchar(255) null, "target_label" varchar(255) null, "organization_id" uuid null, "outcome" varchar(16) not null, "reason_code" varchar(127) null, "details" jsonb not null, "source" varchar(16) not null, "request_id" uuid null, "trace_id" varchar(32) null, "session_id" uuid null, "client_ip" inet null, "user_agent" text null, primary key ("id"));

create index "idx_audit_events_tenant_action_time" on "audit_events" ("tenant_id", "action_code", "occurred_at" DESC);

create index "idx_audit_events_tenant_actor_time" on "audit_events" ("tenant_id", "actor_user_id", "occurred_at" DESC);

create index "idx_audit_events_tenant_target_time" on "audit_events" ("tenant_id", "target_kind", "target_id", "occurred_at" DESC);

create index "idx_audit_events_tenant_time" on "audit_events" ("tenant_id", "occurred_at", "id");

alter table "audit_events" add constraint "audit_events_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "audit_events" add constraint "chk_audit_events_action_code_format" check (action_code ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'::text);

alter table "audit_events" add constraint "chk_audit_events_actor_kind" check ("actor_kind" in ('user', 'system', 'service', 'anonymous'));

alter table "audit_events" add constraint "chk_audit_events_outcome" check ("outcome" in ('success', 'denied', 'failure'));

alter table "audit_events" add constraint "chk_audit_events_source" check ("source" in ('http', 'job', 'cli', 'system'));
