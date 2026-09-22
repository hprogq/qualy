create table "secrets" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "owner_kind" varchar(63) not null, "owner_id" uuid not null, "key" varchar(127) not null, "ciphertext" bytea not null, "nonce" bytea not null, "auth_tag" bytea not null, "key_version" int2 not null default 1, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_secrets_owner_key" on "secrets" ("tenant_id", "owner_kind", "owner_id", "key");

alter table "secrets" add constraint "chk_secrets_auth_tag_length" check (octet_length(auth_tag) = 16);

alter table "secrets" add constraint "chk_secrets_nonce_length" check (octet_length(nonce) = 12);
