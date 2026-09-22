create table "auth_rate_limit_buckets" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "scope" varchar(63) not null, "key_hash" char(64) not null, "window_started_at" timestamptz(6) not null, "attempts" int4 not null, "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_auth_rate_limit_buckets_updated" on "auth_rate_limit_buckets" ("updated_at");

create unique index "uq_auth_rate_limit_buckets_key" on "auth_rate_limit_buckets" ("tenant_id", "scope", "key_hash");

create table "session_auth_grants" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "session_id" uuid not null, "auth_provider_id" uuid not null, "kind" varchar(63) not null, "state_sealed" text not null, "expires_at" timestamptz(6) null, "version" int4 not null default 1, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_session_auth_grants_provider" on "session_auth_grants" ("tenant_id", "auth_provider_id");

create unique index "uq_session_auth_grants_kind" on "session_auth_grants" ("tenant_id", "session_id", "auth_provider_id", "kind");

alter table "auth_rate_limit_buckets" add constraint "auth_rate_limit_buckets_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "session_auth_grants" add constraint "fk_session_auth_grants_provider" foreign key ("tenant_id", "auth_provider_id") references "auth_providers" ("tenant_id", "id") on update no action on delete restrict;

alter table "session_auth_grants" add constraint "fk_session_auth_grants_session" foreign key ("tenant_id", "session_id") references "sessions" ("tenant_id", "id") on update no action on delete cascade;

alter table "session_auth_grants" add constraint "session_auth_grants_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;
