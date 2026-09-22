create table "auth_flows" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "auth_provider_id" uuid not null, "state_hash" char(64) not null, "purpose" varchar(15) not null, "user_id" uuid null, "session_id" uuid null, "return_path" varchar(255) null, "payload_sealed" text null, "expires_at" timestamptz(6) not null, "consumed_at" timestamptz(6) null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_auth_flows_expires" on "auth_flows" ("expires_at");

create index "idx_auth_flows_open_provider" on "auth_flows" ("tenant_id", "auth_provider_id") where consumed_at IS NULL;

create index "idx_auth_flows_open_user" on "auth_flows" ("tenant_id", "user_id") where consumed_at IS NULL;

alter table "auth_flows" add constraint "uq_auth_flows_state" unique ("state_hash");

create unique index "uq_sessions_tenant_id_id" on "sessions" ("tenant_id", "id");

alter table "auth_flows" add constraint "auth_flows_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "auth_flows" add constraint "fk_auth_flows_provider" foreign key ("tenant_id", "auth_provider_id") references "auth_providers" ("tenant_id", "id") on update no action on delete restrict;

alter table "auth_flows" add constraint "fk_auth_flows_session" foreign key ("tenant_id", "session_id") references "sessions" ("tenant_id", "id") on update no action on delete cascade;

alter table "auth_flows" add constraint "fk_auth_flows_user" foreign key ("tenant_id", "user_id") references "users" ("tenant_id", "id") on update no action on delete restrict;

alter table "auth_flows" add constraint "chk_auth_flows_bind" check ((purpose = 'bind'::text) = ((user_id IS NOT NULL) AND (session_id IS NOT NULL)));

alter table "auth_flows" add constraint "chk_auth_flows_purpose" check ("purpose" in ('login', 'bind'));
