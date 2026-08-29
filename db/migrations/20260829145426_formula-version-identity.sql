-- Idempotent on purpose: the same DDL was applied to development databases
-- under this migration's pre-rename filename (the dev supervisor picks up
-- db/migrations/ the moment generate writes it), so this file replays as a
-- no-op there and builds the columns normally everywhere else.
alter table "assessment_formula_versions" add column if not exists "value_schema_profile_version" int4 not null default 1;
alter table "assessment_formula_versions" add column if not exists "regex_profile_version" int4 not null default 1;
alter table "assessment_formula_versions" add column if not exists "sandbox_abi_version" int4 not null default 1;
alter table "assessment_formula_versions" add column if not exists "publish_fingerprint" varchar(64) null;

create unique index if not exists "uq_assessment_formula_versions_fingerprint" on "assessment_formula_versions" ("tenant_id", "function_id", "publish_fingerprint");
