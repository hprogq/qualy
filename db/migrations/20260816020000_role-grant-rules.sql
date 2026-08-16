create table "role_grant_rules" ("tenant_id" uuid not null, "granter_role_id" uuid not null, "target_role_id" uuid not null, "created_at" timestamptz(6) not null default now(), constraint "pk_role_grant_rules" primary key ("tenant_id", "granter_role_id", "target_role_id"));

create index "idx_role_grant_rules_tenant_target" on "role_grant_rules" ("tenant_id", "target_role_id");

alter table "role_grant_rules" add constraint "fk_role_grant_rules_granter" foreign key ("tenant_id", "granter_role_id") references "roles" ("tenant_id", "id") on update no action on delete cascade;

alter table "role_grant_rules" add constraint "fk_role_grant_rules_target" foreign key ("tenant_id", "target_role_id") references "roles" ("tenant_id", "id") on update no action on delete cascade;

alter table "role_grant_rules" add constraint "role_grant_rules_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;
