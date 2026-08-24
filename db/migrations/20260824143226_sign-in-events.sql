create table "sign_in_events" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "occurred_at" timestamptz(6) not null default now(), "provider_id" uuid not null, "provider_type" varchar(32) not null, "provider_code" varchar(63) not null, "user_id" uuid null, "identity_id" uuid null, "outcome" varchar(16) not null, "reason_code" varchar(63) null, "session_id" uuid null, "request_id" uuid null, "trace_id" varchar(32) null, "client_ip" inet null, "user_agent" text null, primary key ("id"));

create index "idx_sign_in_events_tenant_ip_time" on "sign_in_events" ("tenant_id", "client_ip", "occurred_at");

create index "idx_sign_in_events_tenant_time" on "sign_in_events" ("tenant_id", "occurred_at");

create index "idx_sign_in_events_tenant_user_time" on "sign_in_events" ("tenant_id", "user_id", "occurred_at");

alter table "sign_in_events" add constraint "sign_in_events_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "sign_in_events" add constraint "chk_sign_in_events_outcome" check ("outcome" in ('success', 'failure'));
