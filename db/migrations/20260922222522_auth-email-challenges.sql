create table "user_email_challenges" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "user_id" uuid not null, "purpose" varchar(15) not null, "target_email" varchar(320) null, "token_hash" char(64) not null, "expires_at" timestamptz(6) not null, "consumed_at" timestamptz(6) null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_user_email_challenges_expires" on "user_email_challenges" ("expires_at");

create index "idx_user_email_challenges_open_user" on "user_email_challenges" ("tenant_id", "user_id", "purpose") where consumed_at IS NULL;

alter table "user_email_challenges" add constraint "uq_user_email_challenges_token" unique ("token_hash");

alter table "user_email_challenges" add constraint "fk_user_email_challenges_user" foreign key ("tenant_id", "user_id") references "users" ("tenant_id", "id") on update no action on delete restrict;

alter table "user_email_challenges" add constraint "user_email_challenges_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "user_email_challenges" add constraint "chk_user_email_challenges_purpose" check ("purpose" in ('verify', 'reset', 'change'));

alter table "user_email_challenges" add constraint "chk_user_email_challenges_target" check ((purpose = 'reset'::text) = (target_email IS NULL));
