create table "assessment_formula_functions" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "owner_node_id" uuid not null, "name" varchar(255) not null, "description" text null, "draft_source_ts" text not null, "draft_tests" jsonb not null, "draft_revision" int4 not null default 1, "created_by" uuid not null, "created_at" timestamptz(6) not null default now(), "updated_by" uuid not null, "updated_at" timestamptz(6) not null default now(), "archived_at" timestamptz(6) null, primary key ("id"));

create index "idx_assessment_formula_functions_tenant_owner" on "assessment_formula_functions" ("tenant_id", "owner_node_id");

create unique index "uq_assessment_formula_functions_tenant_id_id" on "assessment_formula_functions" ("tenant_id", "id");

create table "assessment_formula_versions" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "function_id" uuid not null, "version_no" int4 not null, "source_ts" text not null, "runtime_js" text not null, "input_schema" jsonb not null, "output_schema" jsonb not null, "source_sha256" varchar(64) not null, "runtime_sha256" varchar(64) not null, "contract_sha256" varchar(64) not null, "typescript_version" varchar(63) not null, "esbuild_version" varchar(63) not null, "formula_abi_version" int4 not null, "formula_runtime_sha256" varchar(64) not null, "quickjs_engine_version" varchar(63) not null, "tests" jsonb not null, "test_report" jsonb not null, "published_by" uuid not null, "published_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_assessment_formula_versions_tenant_function_no" on "assessment_formula_versions" ("tenant_id", "function_id", "version_no");

create unique index "uq_assessment_formula_versions_tenant_id_id" on "assessment_formula_versions" ("tenant_id", "id");

alter table "assessment_formula_functions" add constraint "assessment_formula_functions_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "assessment_formula_functions" add constraint "chk_assessment_formula_functions_name_not_blank" check (btrim(name) <> ''::text);

alter table "assessment_formula_versions" add constraint "assessment_formula_versions_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "assessment_formula_versions" add constraint "fk_assessment_formula_versions_function" foreign key ("tenant_id", "function_id") references "assessment_formula_functions" ("tenant_id", "id") on update no action on delete cascade;
