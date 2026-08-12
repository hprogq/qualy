create table "batch_participant_events" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "participant_id" uuid not null, "kind" varchar(31) not null, "actor_id" uuid null, "reason" varchar(500) null, "occurred_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_batch_participant_events_participant" on "batch_participant_events" ("tenant_id", "participant_id", "occurred_at" DESC);

alter table "batch_participant_events" add constraint "batch_participant_events_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "batch_participant_events" add constraint "fk_batch_participant_events_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_participant_events" add constraint "fk_batch_participant_events_participant" foreign key ("tenant_id", "participant_id") references "batch_participants" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_participant_events" add constraint "chk_batch_participant_events_kind" check ("kind" in ('included', 'excluded', 'readmitted'));
