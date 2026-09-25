alter table "role_grants" drop constraint "fk_role_grants_role";

alter table "role_grants" add constraint "fk_role_grants_role" foreign key ("tenant_id", "role_id") references "roles" ("tenant_id", "id") on update no action on delete restrict;
