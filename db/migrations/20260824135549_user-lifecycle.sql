alter table "role_grants" drop constraint "fk_role_grants_user";

alter table "user_identities" drop constraint "fk_user_identities_user";

alter table "users" drop constraint "fk_users_primary_org_node";

alter table "users" drop constraint "fk_users_user_type";

alter table "role_grants" add constraint "fk_role_grants_user" foreign key ("tenant_id", "user_id") references "users" ("tenant_id", "id") on update no action on delete restrict;

drop index "uq_user_identities_login";

drop index "uq_user_identities_user_provider";

alter table "user_identities" add "revoked_at" timestamptz(6) null, add "revoked_by" uuid null;

alter table "user_identities" add constraint "fk_user_identities_user" foreign key ("tenant_id", "user_id") references "users" ("tenant_id", "id") on update no action on delete restrict;

create unique index "uq_user_identities_login" on "user_identities" ("tenant_id", "auth_provider_id", "identifier") where revoked_at IS NULL;

create unique index "uq_user_identities_user_provider" on "user_identities" ("tenant_id", "user_id", "auth_provider_id") where revoked_at IS NULL;

alter table "users" add "deleted_at" timestamptz(6) null, add "version" int4 not null default 1;

alter table "users" alter column "user_type_id" drop not null;

alter table "users" alter column "primary_org_node_id" drop not null;

alter table "users" add constraint "fk_users_primary_org_node" foreign key ("tenant_id", "primary_org_node_id") references "org_nodes" ("tenant_id", "id") on update no action on delete set null (primary_org_node_id);

alter table "users" add constraint "fk_users_user_type" foreign key ("tenant_id", "user_type_id") references "user_types" ("tenant_id", "id") on update no action on delete set null (user_type_id);

alter table "users" add constraint "chk_users_deleted_is_disabled" check ((deleted_at IS NULL) OR (enabled = false));

alter table "users" add constraint "chk_users_live_user_is_placed" check ((deleted_at IS NOT NULL) OR ((user_type_id IS NOT NULL) AND (primary_org_node_id IS NOT NULL)));

drop index "uq_user_identities_user_provider";

CREATE UNIQUE INDEX uq_user_identities_user_provider ON public.user_identities USING btree (tenant_id, user_id, auth_provider_id) WHERE (revoked_at IS NULL);

drop index "uq_user_identities_login";

CREATE UNIQUE INDEX uq_user_identities_login ON public.user_identities USING btree (tenant_id, auth_provider_id, identifier) WHERE (revoked_at IS NULL);
