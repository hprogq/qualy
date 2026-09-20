create table "directory_import_events" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "import_id" uuid not null, "kind" varchar(32) not null, "actor_id" uuid null, "reason" varchar(500) null, "affected_user_count" int4 not null default 0, "deleted_node_count" int4 not null default 0, "retained_node_count" int4 not null default 0, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_directory_import_events_import" on "directory_import_events" ("tenant_id", "import_id", "created_at" DESC);

create table "directory_import_nodes" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "import_id" uuid not null, "org_node_id" uuid null, "parent_node_id_snapshot" uuid null, "org_type_id_snapshot" uuid not null, "name_snapshot" varchar(255) not null, "path_snapshot" text not null, "depth_in_import" int4 not null, "disposition" varchar(16) not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_directory_import_nodes_import" on "directory_import_nodes" ("tenant_id", "import_id", "depth_in_import");

create table "directory_import_rows" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "import_id" uuid not null, "source_row_no" int4 not null, "user_id" uuid null, "business_no_snapshot" varchar(64) not null, "display_name_snapshot" varchar(255) not null, "primary_org_node_id_snapshot" uuid null, "primary_org_path_snapshot" text not null, "disposition" varchar(16) not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_directory_import_rows_import" on "directory_import_rows" ("tenant_id", "import_id", "source_row_no");

create index "idx_directory_import_rows_user" on "directory_import_rows" ("tenant_id", "user_id");

create table "directory_imports" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "source_attachment_id" uuid not null, "filename_snapshot" varchar(255) not null, "size_bytes" int8 not null, "content_hash_algorithm" varchar(32) null, "content_hash" varchar(128) null, "actor_id" uuid null, "sheet_name" varchar(255) not null, "header_row" int4 not null, "user_type_id" uuid not null, "anchor_node_id" uuid not null, "mapping_snapshot" jsonb not null, "chain_snapshot" jsonb not null, "source_row_count" int4 not null, "created_user_count" int4 not null, "existing_user_count" int4 not null, "created_node_count" int4 not null, "reused_node_count" int4 not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_directory_imports_tenant_time" on "directory_imports" ("tenant_id", "created_at" DESC, "id");

create unique index "uq_directory_imports_source" on "directory_imports" ("tenant_id", "source_attachment_id");

alter table "directory_import_events" add constraint "directory_import_events_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "directory_import_events" add constraint "chk_directory_import_events_kind" check ("kind" in ('reversed', 'nodes-cleaned'));

alter table "directory_import_nodes" add constraint "directory_import_nodes_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "directory_import_nodes" add constraint "chk_directory_import_nodes_disposition" check ("disposition" in ('created', 'reused'));

alter table "directory_import_rows" add constraint "directory_import_rows_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "directory_import_rows" add constraint "chk_directory_import_rows_disposition" check ("disposition" in ('created', 'existing'));

alter table "directory_imports" add constraint "directory_imports_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;
