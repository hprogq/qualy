create table "tenant_setting_values" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "setting_id" varchar(191) not null, "value" jsonb not null, "version" int4 not null default 1, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_tenant_setting_values_tenant_setting" on "tenant_setting_values" ("tenant_id", "setting_id");

alter table "tenant_setting_values" add constraint "tenant_setting_values_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "tenant_setting_values" add constraint "chk_tenant_setting_values_setting_id_format" check (setting_id ~ '^[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*$'::text);

alter table "tenant_setting_values" add constraint "chk_tenant_setting_values_version_positive" check (version >= 1);
