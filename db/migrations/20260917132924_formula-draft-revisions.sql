create table "assessment_formula_draft_revisions" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "function_id" uuid not null, "revision_no" int4 not null, "source_ts" text not null, "tests" jsonb not null, "source_sha256" varchar(64) not null, "saved_by" uuid not null, "saved_at" timestamptz(6) not null default now(), "origin" varchar(32) not null, "source_version_id" uuid null, "source_draft_revision_no" int4 null, primary key ("id"));

create unique index "uq_assessment_formula_draft_revisions_no" on "assessment_formula_draft_revisions" ("tenant_id", "function_id", "revision_no");

alter table "assessment_formula_versions" add "release_name" varchar(100) null, add "release_notes" text null;

create unique index "uq_assessment_formula_versions_release_name" on "assessment_formula_versions" ("tenant_id", "function_id", "release_name") where release_name IS NOT NULL;

alter table "assessment_formula_versions" add constraint "chk_assessment_formula_versions_release_name_not_blank" check ((release_name IS NULL) OR (btrim(release_name) <> ''::text));

alter table "assessment_formula_draft_revisions" add constraint "assessment_formula_draft_revisions_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "assessment_formula_draft_revisions" add constraint "fk_assessment_formula_draft_revisions_function" foreign key ("tenant_id", "function_id") references "assessment_formula_functions" ("tenant_id", "id") on update no action on delete cascade;

alter table "assessment_formula_draft_revisions" add constraint "chk_assessment_formula_draft_revisions_origin" check ("origin" in ('created', 'saved', 'restored-from-version', 'restored-from-draft', 'copied-from-template', 'migration'));

-- The draft history starts here. Every formula's current draft becomes its
-- first recorded revision, under the revision number it already carries;
-- nothing earlier is reconstructed, because no earlier source was ever kept.
insert into "assessment_formula_draft_revisions"
  ("tenant_id", "function_id", "revision_no", "source_ts", "tests", "source_sha256", "saved_by", "saved_at", "origin")
select f.tenant_id,
       f.id,
       f.draft_revision,
       f.draft_source_ts,
       f.draft_tests,
       encode(sha256(convert_to(f.draft_source_ts, 'UTF8')), 'hex'),
       f.updated_by,
       f.updated_at,
       'migration'
  from assessment_formula_functions f;
