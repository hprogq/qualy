create table "administrative_entry_import_events" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "import_id" uuid not null, "kind" varchar(32) not null, "actor_id" uuid null, "reason" varchar(500) null, "affected_count" int4 not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_administrative_entry_import_events_import" on "administrative_entry_import_events" ("tenant_id", "import_id", "created_at" DESC);

create table "administrative_entry_import_rows" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "import_id" uuid not null, "source_row_no" int4 not null, "participant_id" uuid not null, "entry_id" uuid not null, "business_no_snapshot" varchar(100) null, "display_name_snapshot" varchar(255) null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_administrative_entry_import_rows_entry" on "administrative_entry_import_rows" ("tenant_id", "entry_id");

create unique index "uq_administrative_entry_import_rows_row" on "administrative_entry_import_rows" ("tenant_id", "import_id", "source_row_no");

create table "administrative_entry_imports" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "item_id" uuid not null, "item_revision_id" uuid not null, "source_attachment_id" uuid null, "filename_snapshot" varchar(255) not null, "size_bytes" int8 not null, "content_hash_algorithm" varchar(32) null, "content_hash" varchar(128) null, "actor_id" uuid null, "default_basis" varchar(500) null, "imported_count" int4 not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_administrative_entry_imports_batch" on "administrative_entry_imports" ("tenant_id", "batch_id", "created_at" DESC, "id");

create unique index "uq_administrative_entry_imports_tenant_id_id" on "administrative_entry_imports" ("tenant_id", "id");

alter table "administrative_entry_import_events" add constraint "administrative_entry_import_events_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "administrative_entry_import_events" add constraint "fk_administrative_entry_import_events_import" foreign key ("tenant_id", "import_id") references "administrative_entry_imports" ("tenant_id", "id") on update no action on delete cascade;

alter table "administrative_entry_import_rows" add constraint "administrative_entry_import_rows_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "administrative_entry_import_rows" add constraint "fk_administrative_entry_import_rows_entry" foreign key ("tenant_id", "entry_id") references "entries" ("tenant_id", "id") on update no action on delete cascade;

alter table "administrative_entry_import_rows" add constraint "fk_administrative_entry_import_rows_import" foreign key ("tenant_id", "import_id") references "administrative_entry_imports" ("tenant_id", "id") on update no action on delete cascade;

alter table "administrative_entry_imports" add constraint "administrative_entry_imports_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "administrative_entry_imports" add constraint "fk_administrative_entry_imports_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "administrative_entry_imports" add constraint "fk_administrative_entry_imports_item" foreign key ("tenant_id", "item_id") references "assessment_items" ("tenant_id", "id") on update no action on delete cascade;
