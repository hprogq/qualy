create table "administrative_record_operation_events" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "operation_id" uuid not null, "kind" varchar(32) not null, "actor_id" uuid null, "reason" varchar(500) null, "affected_count" int4 not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_administrative_record_operation_events_operation" on "administrative_record_operation_events" ("tenant_id", "operation_id", "created_at" DESC);

create table "administrative_record_operation_rows" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "operation_id" uuid not null, "participant_id" uuid not null, "entry_id" uuid not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_administrative_record_operation_rows_entry" on "administrative_record_operation_rows" ("tenant_id", "entry_id");

create unique index "uq_administrative_record_operation_rows_participant" on "administrative_record_operation_rows" ("tenant_id", "operation_id", "participant_id");

create table "administrative_record_operations" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "item_id" uuid not null, "item_revision_id" uuid not null, "target_kind" varchar(16) not null, "target_spec" jsonb not null, "actor_id" uuid null, "recorded_count" int4 not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_administrative_record_operations_batch" on "administrative_record_operations" ("tenant_id", "batch_id", "created_at" DESC, "id");

create unique index "uq_administrative_record_operations_tenant_id_id" on "administrative_record_operations" ("tenant_id", "id");

alter table "administrative_record_operation_events" add constraint "administrative_record_operation_events_tenant_id_tenants_id_fke" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "administrative_record_operation_events" add constraint "fk_administrative_record_operation_events_operation" foreign key ("tenant_id", "operation_id") references "administrative_record_operations" ("tenant_id", "id") on update no action on delete cascade;

alter table "administrative_record_operation_rows" add constraint "administrative_record_operation_rows_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "administrative_record_operation_rows" add constraint "fk_administrative_record_operation_rows_entry" foreign key ("tenant_id", "entry_id", "participant_id") references "entries" ("tenant_id", "id", "participant_id") on update no action on delete cascade;

alter table "administrative_record_operation_rows" add constraint "fk_administrative_record_operation_rows_operation" foreign key ("tenant_id", "operation_id") references "administrative_record_operations" ("tenant_id", "id") on update no action on delete cascade;

alter table "administrative_record_operations" add constraint "administrative_record_operations_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "administrative_record_operations" add constraint "fk_administrative_record_operations_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "administrative_record_operations" add constraint "fk_administrative_record_operations_item" foreign key ("tenant_id", "batch_id", "item_id") references "assessment_items" ("tenant_id", "batch_id", "id") on update no action on delete cascade;

alter table "administrative_record_operations" add constraint "fk_administrative_record_operations_item_revision" foreign key ("tenant_id", "item_id", "item_revision_id") references "assessment_item_revisions" ("tenant_id", "item_id", "id") on update no action on delete cascade;

alter table "administrative_record_operations" add constraint "chk_administrative_record_operations_target_kind" check ("target_kind" in ('people', 'organization'));
