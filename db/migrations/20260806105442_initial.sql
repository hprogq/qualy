-- qualy-baseline: @qualy/plugin-org db/baseline/0001_ltree.sql 5246aa11cd897116
-- phase: pre-structure

-- org_nodes stores its position as an ltree path, so the type has to exist
-- before the table can be created. IF NOT EXISTS because a baseline fragment
-- states what must be true rather than what changed: it runs against a fresh
-- database and against one that already has the extension from the lineage
-- that predates this file.
CREATE EXTENSION IF NOT EXISTS ltree;

create table "auth_providers" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "code" varchar(63) not null, "type" varchar(32) not null, "name" varchar(100) not null, "config" jsonb not null default '{}', "is_system" bool not null default false, "enabled" bool not null default true, "sort_order" int2 not null default 0, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_auth_providers_tenant_code" on "auth_providers" ("tenant_id", "code");

create unique index "uq_auth_providers_tenant_id_id" on "auth_providers" ("tenant_id", "id");

create table "org_nodes" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "parent_id" uuid null, "org_type_id" uuid not null, "code" varchar(63) null, "name" varchar(255) not null, "path" ltree not null, "depth" int2 not null default 0, "sort_order" int2 not null default 0, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_org_nodes_parent_sort" on "org_nodes" ("tenant_id", "parent_id", "sort_order", "name");

CREATE INDEX idx_org_nodes_path_gist ON public.org_nodes USING gist (path);

create index "idx_org_nodes_tenant_type" on "org_nodes" ("tenant_id", "org_type_id");

create unique index "uq_org_nodes_tenant_code" on "org_nodes" ("tenant_id", "code") where code IS NOT NULL;

create unique index "uq_org_nodes_tenant_id_id" on "org_nodes" ("tenant_id", "id");

create unique index "uq_org_nodes_tenant_parent_name" on "org_nodes" ("tenant_id", "parent_id", "name") where parent_id IS NOT NULL;

create unique index "uq_org_nodes_tenant_path" on "org_nodes" ("tenant_id", "path");

create unique index "uq_org_nodes_tenant_root_name" on "org_nodes" ("tenant_id", "name") where parent_id IS NULL;

create unique index "uq_org_nodes_tenant_single_root" on "org_nodes" ("tenant_id") where parent_id IS NULL;

create table "org_type_rules" ("tenant_id" uuid not null, "parent_type_id" uuid not null, "child_type_id" uuid not null, "created_at" timestamptz(6) not null default now(), constraint "pk_org_type_rules" primary key ("tenant_id", "parent_type_id", "child_type_id"));

create index "idx_org_type_rules_tenant_child" on "org_type_rules" ("tenant_id", "child_type_id");

create table "org_types" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "code" varchar(63) not null, "name" varchar(100) not null, "sort_order" int2 not null default 0, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_org_types_tenant_code" on "org_types" ("tenant_id", "code");

create unique index "uq_org_types_tenant_id_id" on "org_types" ("tenant_id", "id");

create unique index "uq_org_types_tenant_name" on "org_types" ("tenant_id", "name");

create table "permissions" ("id" uuid not null default uuidv7(), "code" varchar(127) not null, "plugin" varchar(127) not null, "name" varchar(100) not null, "description" varchar(500) null, "group_key" varchar(63) null, "target_kind" varchar(16) not null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_permissions_code" on "permissions" ("code");

create table "ping_logs" ("id" uuid not null default uuidv7(), "name" text not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create table "role_allowed_org_types" ("tenant_id" uuid not null, "role_id" uuid not null, "org_type_id" uuid not null, "created_at" timestamptz(6) not null default now(), constraint "pk_role_allowed_org_types" primary key ("tenant_id", "role_id", "org_type_id"));

create table "role_allowed_user_types" ("tenant_id" uuid not null, "role_id" uuid not null, "user_type_id" uuid not null, "created_at" timestamptz(6) not null default now(), constraint "pk_role_allowed_user_types" primary key ("tenant_id", "role_id", "user_type_id"));

create table "role_grants" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "user_id" uuid not null, "role_id" uuid not null, "org_node_id" uuid null, "coverage" varchar(16) null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_role_grants_tenant_node" on "role_grants" ("tenant_id", "org_node_id");

create index "idx_role_grants_tenant_role" on "role_grants" ("tenant_id", "role_id");

create index "idx_role_grants_tenant_user" on "role_grants" ("tenant_id", "user_id");

create unique index "uq_role_grants_anchored" on "role_grants" ("tenant_id", "user_id", "role_id", "org_node_id", "coverage") where org_node_id IS NOT NULL;

create unique index "uq_role_grants_tenant_wide" on "role_grants" ("tenant_id", "user_id", "role_id") where org_node_id IS NULL;

create table "role_permissions" ("tenant_id" uuid not null, "role_id" uuid not null, "permission_id" uuid not null, "created_at" timestamptz(6) not null default now(), constraint "pk_role_permissions" primary key ("tenant_id", "role_id", "permission_id"));

create index "idx_role_permissions_tenant_role" on "role_permissions" ("tenant_id", "role_id");

create table "roles" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "code" varchar(63) not null, "name" varchar(100) not null, "description" varchar(500) null, "kind" varchar(16) not null, "status" varchar(16) not null default 'draft', "permission_mode" varchar(16) not null default 'explicit', "system_key" varchar(63) null, "assignable" bool not null default true, "version" int4 not null default 1, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_roles_tenant_code" on "roles" ("tenant_id", "code");

create unique index "uq_roles_tenant_id_id" on "roles" ("tenant_id", "id");

create unique index "uq_roles_tenant_name" on "roles" ("tenant_id", "name");

create unique index "uq_roles_tenant_system_key" on "roles" ("tenant_id", "system_key") where system_key IS NOT NULL;

create table "sessions" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "user_id" uuid not null, "token_hash" char(64) not null, "expires_at" timestamptz(6) not null, "last_used_at" timestamptz(6) null, "login_ip" inet null, "user_agent" text null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_sessions_tenant_user_expires" on "sessions" ("tenant_id", "user_id", "expires_at");

alter table "sessions" add constraint "sessions_token_hash_key" unique ("token_hash");

create table "tenants" ("id" uuid not null default uuidv7(), "slug" varchar(63) not null, "name" varchar(255) not null, "logo_url" varchar(2048) null, "enabled" bool not null default true, "expires_at" timestamptz(6) null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

alter table "tenants" add constraint "tenants_slug_key" unique ("slug");

create table "user_identities" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "user_id" uuid not null, "auth_provider_id" uuid not null, "identifier" varchar(255) not null, "credential_hash" text null, "bound_at" timestamptz(6) not null default now(), "last_used_at" timestamptz(6) null, primary key ("id"));

create unique index "uq_user_identities_login" on "user_identities" ("tenant_id", "auth_provider_id", "identifier");

create unique index "uq_user_identities_tenant_id_id" on "user_identities" ("tenant_id", "id");

create unique index "uq_user_identities_user_provider" on "user_identities" ("tenant_id", "user_id", "auth_provider_id");

create table "user_type_allowed_org_types" ("tenant_id" uuid not null, "user_type_id" uuid not null, "org_type_id" uuid not null, "created_at" timestamptz(6) not null default now(), constraint "pk_user_type_allowed_org_types" primary key ("tenant_id", "user_type_id", "org_type_id"));

create index "idx_user_type_allowed_org_types_tenant_type" on "user_type_allowed_org_types" ("tenant_id", "user_type_id");

create table "user_types" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "code" varchar(63) not null, "name" varchar(100) not null, "description" varchar(500) null, "allow_local_login" bool not null default false, "allow_sso_login" bool not null default false, "enabled" bool not null default true, "is_system" bool not null default false, "placement_mode" varchar(16) not null, "version" int4 not null default 1, "sort_order" int2 not null default 0, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_user_types_tenant_code" on "user_types" ("tenant_id", "code");

create unique index "uq_user_types_tenant_id_id" on "user_types" ("tenant_id", "id");

create unique index "uq_user_types_tenant_name" on "user_types" ("tenant_id", "name");

create table "users" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "business_no" varchar(64) null, "display_name" varchar(100) not null, "user_type_id" uuid not null, "primary_org_node_id" uuid not null, "enabled" bool not null default true, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_users_tenant_org_node_name" on "users" ("tenant_id", "primary_org_node_id", "display_name");

create index "idx_users_tenant_user_type" on "users" ("tenant_id", "user_type_id");

create unique index "uq_users_tenant_business_no" on "users" ("tenant_id", "business_no") where business_no IS NOT NULL;

create unique index "uq_users_tenant_id_id" on "users" ("tenant_id", "id");

alter table "auth_providers" add constraint "auth_providers_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "auth_providers" add constraint "chk_auth_providers_code_format" check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);

alter table "auth_providers" add constraint "chk_auth_providers_sort_order_non_negative" check (sort_order >= 0);

alter table "auth_providers" add constraint "chk_auth_providers_type_format" check (type ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);

alter table "org_nodes" add constraint "fk_org_nodes_org_type" foreign key ("tenant_id", "org_type_id") references "org_types" ("tenant_id", "id") on update no action on delete restrict;

alter table "org_nodes" add constraint "fk_org_nodes_parent" foreign key ("tenant_id", "parent_id") references "org_nodes" ("tenant_id", "id") on update no action on delete restrict;

alter table "org_nodes" add constraint "org_nodes_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "org_nodes" add constraint "chk_org_nodes_code_format" check ((code IS NULL) OR (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text));

alter table "org_nodes" add constraint "chk_org_nodes_depth_non_negative" check (depth >= 0);

alter table "org_nodes" add constraint "chk_org_nodes_name_not_blank" check (btrim(name) <> ''::text);

alter table "org_nodes" add constraint "chk_org_nodes_parent_not_self" check ((parent_id IS NULL) OR (parent_id <> id));

alter table "org_nodes" add constraint "chk_org_nodes_sort_order_non_negative" check (sort_order >= 0);

alter table "org_type_rules" add constraint "fk_org_type_rules_child" foreign key ("tenant_id", "child_type_id") references "org_types" ("tenant_id", "id") on update no action on delete cascade;

alter table "org_type_rules" add constraint "fk_org_type_rules_parent" foreign key ("tenant_id", "parent_type_id") references "org_types" ("tenant_id", "id") on update no action on delete cascade;

alter table "org_type_rules" add constraint "org_type_rules_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "org_type_rules" add constraint "chk_org_type_rules_no_self_loop" check (parent_type_id <> child_type_id);

alter table "org_types" add constraint "org_types_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "org_types" add constraint "chk_org_types_code_format" check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);

alter table "org_types" add constraint "chk_org_types_name_not_blank" check (btrim(name) <> ''::text);

alter table "org_types" add constraint "chk_org_types_sort_order_non_negative" check (sort_order >= 0);

alter table "permissions" add constraint "chk_permissions_code_format" check (code ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'::text);

alter table "permissions" add constraint "chk_permissions_target_kind" check ("target_kind" in ('tenant', 'org-node'));

alter table "role_allowed_org_types" add constraint "fk_role_allowed_org_types_role" foreign key ("tenant_id", "role_id") references "roles" ("tenant_id", "id") on update no action on delete cascade;

alter table "role_allowed_org_types" add constraint "fk_role_allowed_org_types_type" foreign key ("tenant_id", "org_type_id") references "org_types" ("tenant_id", "id") on update no action on delete restrict;

alter table "role_allowed_org_types" add constraint "role_allowed_org_types_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "role_allowed_user_types" add constraint "fk_role_allowed_user_types_role" foreign key ("tenant_id", "role_id") references "roles" ("tenant_id", "id") on update no action on delete cascade;

alter table "role_allowed_user_types" add constraint "fk_role_allowed_user_types_type" foreign key ("tenant_id", "user_type_id") references "user_types" ("tenant_id", "id") on update no action on delete cascade;

alter table "role_allowed_user_types" add constraint "role_allowed_user_types_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "role_grants" add constraint "fk_role_grants_node" foreign key ("tenant_id", "org_node_id") references "org_nodes" ("tenant_id", "id") on update no action on delete restrict;

alter table "role_grants" add constraint "fk_role_grants_role" foreign key ("tenant_id", "role_id") references "roles" ("tenant_id", "id") on update no action on delete cascade;

alter table "role_grants" add constraint "fk_role_grants_user" foreign key ("tenant_id", "user_id") references "users" ("tenant_id", "id") on update no action on delete cascade;

alter table "role_grants" add constraint "role_grants_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "role_grants" add constraint "chk_role_grants_anchor" check ((org_node_id IS NULL) = (coverage IS NULL));

alter table "role_grants" add constraint "chk_role_grants_coverage" check ("coverage" in ('self', 'subtree'));

alter table "role_permissions" add constraint "fk_role_permissions_role" foreign key ("tenant_id", "role_id") references "roles" ("tenant_id", "id") on update no action on delete cascade;

alter table "role_permissions" add constraint "role_permissions_permission_id_permissions_id_fkey" foreign key ("permission_id") references "permissions" ("id") on update no action on delete cascade;

alter table "role_permissions" add constraint "role_permissions_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "roles" add constraint "roles_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "roles" add constraint "chk_roles_all_active_is_system" check ((permission_mode <> 'all-active'::text) OR (NOT (system_key IS DISTINCT FROM 'tenant-admin'::text)));

alter table "roles" add constraint "chk_roles_code_format" check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);

alter table "roles" add constraint "chk_roles_kind" check ("kind" in ('tenant', 'org'));

alter table "roles" add constraint "chk_roles_name_not_blank" check (btrim(name) <> ''::text);

alter table "roles" add constraint "chk_roles_permission_mode" check ("permission_mode" in ('explicit', 'all-active'));

alter table "roles" add constraint "chk_roles_status" check ("status" in ('draft', 'active', 'disabled'));

alter table "roles" add constraint "chk_roles_tenant_admin_shape" check ((system_key <> 'tenant-admin'::text) OR ((permission_mode = 'all-active'::text) AND (kind = 'tenant'::text) AND (status = 'active'::text) AND assignable));

alter table "sessions" add constraint "fk_sessions_user" foreign key ("tenant_id", "user_id") references "users" ("tenant_id", "id") on update no action on delete cascade;

alter table "sessions" add constraint "sessions_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "tenants" add constraint "chk_tenants_name_not_blank" check (btrim(name) <> ''::text);

alter table "tenants" add constraint "chk_tenants_slug_format" check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);

alter table "user_identities" add constraint "fk_user_identities_provider" foreign key ("tenant_id", "auth_provider_id") references "auth_providers" ("tenant_id", "id") on update no action on delete restrict;

alter table "user_identities" add constraint "fk_user_identities_user" foreign key ("tenant_id", "user_id") references "users" ("tenant_id", "id") on update no action on delete cascade;

alter table "user_identities" add constraint "user_identities_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "user_type_allowed_org_types" add constraint "fk_user_type_allowed_org_types_org_type" foreign key ("tenant_id", "org_type_id") references "org_types" ("tenant_id", "id") on update no action on delete restrict;

alter table "user_type_allowed_org_types" add constraint "fk_user_type_allowed_org_types_type" foreign key ("tenant_id", "user_type_id") references "user_types" ("tenant_id", "id") on update no action on delete cascade;

alter table "user_type_allowed_org_types" add constraint "user_type_allowed_org_types_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "user_types" add constraint "user_types_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "user_types" add constraint "chk_user_types_code_format" check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);

alter table "user_types" add constraint "chk_user_types_name_not_blank" check (btrim(name) <> ''::text);

alter table "user_types" add constraint "chk_user_types_placement_mode" check ("placement_mode" in ('unrestricted', 'allow-list'));

alter table "user_types" add constraint "chk_user_types_sort_order_non_negative" check (sort_order >= 0);

alter table "users" add constraint "fk_users_primary_org_node" foreign key ("tenant_id", "primary_org_node_id") references "org_nodes" ("tenant_id", "id") on update no action on delete restrict;

alter table "users" add constraint "fk_users_user_type" foreign key ("tenant_id", "user_type_id") references "user_types" ("tenant_id", "id") on update no action on delete restrict;

alter table "users" add constraint "users_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "users" add constraint "chk_users_display_name_not_blank" check (btrim(display_name) <> ''::text);
