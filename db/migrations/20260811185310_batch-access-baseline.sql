create table "batch_access_denies" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "subject_id" uuid not null, "permission_code" varchar(127) not null, "reason" text null, "created_at" timestamptz(6) not null default now(), "created_by" uuid null, primary key ("id"));

create unique index "uq_batch_access_denies" on "batch_access_denies" ("tenant_id", "batch_id", "subject_id", "permission_code");

create table "batch_access_source_permissions" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "source_id" uuid not null, "permission_code" varchar(127) not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_batch_access_source_permissions" on "batch_access_source_permissions" ("tenant_id", "source_id", "permission_code");

create table "batch_access_sources" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "role_assignment_id" uuid not null, "subject_id" uuid not null, "origin" varchar(16) not null, "accepted_at" timestamptz(6) not null default now(), "accepted_by" uuid null, primary key ("id"));

create index "idx_batch_access_sources_subject" on "batch_access_sources" ("tenant_id", "batch_id", "subject_id");

create unique index "uq_batch_access_sources_assignment" on "batch_access_sources" ("tenant_id", "batch_id", "role_assignment_id");

create unique index "uq_batch_access_sources_tenant_id_id" on "batch_access_sources" ("tenant_id", "id");

alter table "batch_access_denies" add constraint "batch_access_denies_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "batch_access_denies" add constraint "fk_batch_access_denies_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_access_denies" add constraint "fk_batch_access_denies_subject" foreign key ("tenant_id", "subject_id") references "users" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_access_source_permissions" add constraint "batch_access_source_permissions_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "batch_access_source_permissions" add constraint "fk_batch_access_source_permissions_source" foreign key ("tenant_id", "source_id") references "batch_access_sources" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_access_sources" add constraint "batch_access_sources_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "batch_access_sources" add constraint "fk_batch_access_sources_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_access_sources" add constraint "fk_batch_access_sources_subject" foreign key ("tenant_id", "subject_id") references "users" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_access_sources" add constraint "chk_batch_access_sources_origin" check ("origin" in ('inherited', 'explicit'));

alter table "role_grants" add "resource_namespace" varchar(63) null, add "resource_type" varchar(63) null, add "resource_id" uuid null, add "valid_from" timestamptz(6) null, add "valid_until" timestamptz(6) null, add "revoked_at" timestamptz(6) null, add "revoked_by" uuid null, add "created_by" uuid null;

create index "idx_role_grants_resource" on "role_grants" ("tenant_id", "resource_namespace", "resource_type", "resource_id") where resource_id IS NOT NULL;

alter table "role_grants" add constraint "chk_role_grants_resource" check (num_nonnulls(resource_namespace, resource_type, resource_id) = ANY (ARRAY[0, 3]));

alter table "role_grants" add constraint "chk_role_grants_validity" check ((valid_from IS NULL) OR (valid_until IS NULL) OR (valid_from < valid_until));

drop index "uq_role_grants_anchored";

CREATE UNIQUE INDEX uq_role_grants_anchored ON public.role_grants USING btree (tenant_id, user_id, role_id, org_node_id, coverage, COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE ((org_node_id IS NOT NULL) AND (revoked_at IS NULL));

drop index "uq_role_grants_tenant_wide";

CREATE UNIQUE INDEX uq_role_grants_tenant_wide ON public.role_grants USING btree (tenant_id, user_id, role_id, COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE ((org_node_id IS NULL) AND (revoked_at IS NULL));
