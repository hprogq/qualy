-- destructive: approved
-- the flags whose meaning moved into the providers' own audiences
alter table "auth_provider_user_types" drop constraint "auth_provider_user_types_tenant_id_tenants_id_fkey";

alter table "auth_provider_user_types" add constraint "auth_provider_user_types_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "user_types" drop column "allow_local_login", drop column "allow_sso_login";
