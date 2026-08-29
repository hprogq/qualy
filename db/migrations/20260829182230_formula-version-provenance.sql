-- provenance columns for published formula versions; idempotent because the
-- dev supervisor can apply the freshly generated file before it is renamed
alter table "assessment_formula_versions"
  add column if not exists "source_policy_version" int4 not null default 1,
  add column if not exists "source_policy_parser_version" varchar(63) not null default 'unrecorded',
  add column if not exists "authoring_build_id" varchar(64) not null default 'unrecorded',
  add column if not exists "sandbox_runtime_build_id" varchar(64) not null default 'unrecorded';
