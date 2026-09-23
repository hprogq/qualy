-- Challenges a proof of work has already been spent on, for the ALTCHA
-- provider to refuse the same solved challenge twice.

create table "captcha_altcha_used_challenges" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "challenge_id" uuid not null, "expires_at" timestamptz(6) not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_captcha_altcha_used_challenges_expires_at" on "captcha_altcha_used_challenges" ("expires_at");

create unique index "uq_captcha_altcha_used_challenges_challenge" on "captcha_altcha_used_challenges" ("tenant_id", "challenge_id");
