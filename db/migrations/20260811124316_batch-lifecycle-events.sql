create table "batch_lifecycle_events" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "kind" varchar(31) not null, "occurred_at" timestamptz(6) not null default now(), "actor_id" uuid null, "reason" text null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_batch_lifecycle_events_tenant_batch_occurred" on "batch_lifecycle_events" ("tenant_id", "batch_id", "occurred_at");

alter table "batch_lifecycle_events" add constraint "batch_lifecycle_events_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "batch_lifecycle_events" add constraint "fk_batch_lifecycle_events_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_lifecycle_events" add constraint "chk_batch_lifecycle_events_kind" check ("kind" in ('archived', 'reopened'));

alter table "batch_lifecycle_events" add constraint "chk_batch_lifecycle_events_reopen_reason" check ((kind <> 'reopened'::text) OR (btrim(COALESCE(reason, ''::text)) <> ''::text));
