create table "assessment_batches" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "name" varchar(255) not null, "description_md" text null, "scope_node_id" uuid not null, "scope_path" ltree not null, "material_range" daterange not null, "timezone" varchar(63) not null default 'Asia/Shanghai', "status" varchar(16) not null default 'draft', "config_revision" int4 not null default 0, "current_phase_id" uuid null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_assessment_batches_tenant_scope_node" on "assessment_batches" ("tenant_id", "scope_node_id");

create index "idx_assessment_batches_tenant_status" on "assessment_batches" ("tenant_id", "status");

create unique index "uq_assessment_batches_tenant_id_id" on "assessment_batches" ("tenant_id", "id");

create table "batch_config_revisions" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "revision" int4 not null, "actor_id" uuid null, "diff" jsonb not null, "reason" text null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_batch_config_revisions_tenant_batch_revision" on "batch_config_revisions" ("tenant_id", "batch_id", "revision");

create table "batch_participants" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "user_id" uuid not null, "assessment_anchor_node_id" uuid not null, "anchor_path" ltree not null, "anchor_lineage" jsonb not null, "user_type_id" uuid not null, "status" varchar(16) not null default 'active', "included_at" timestamptz(6) not null default now(), "excluded_at" timestamptz(6) null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

CREATE INDEX idx_batch_participants_anchor_path_gist ON public.batch_participants USING gist (anchor_path);

create index "idx_batch_participants_tenant_anchor" on "batch_participants" ("tenant_id", "assessment_anchor_node_id");

create index "idx_batch_participants_tenant_user" on "batch_participants" ("tenant_id", "user_id");

create index "idx_batch_participants_tenant_user_type" on "batch_participants" ("tenant_id", "user_type_id");

create unique index "uq_batch_participants_tenant_batch_user" on "batch_participants" ("tenant_id", "batch_id", "user_id");

create unique index "uq_batch_participants_tenant_id_id" on "batch_participants" ("tenant_id", "id");

create table "batch_phases" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "ordinal" int4 not null, "phase_key" varchar(63) not null, "display_name" varchar(100) not null, "entry_trigger" varchar(16) not null, "planned_entry_at" timestamptz(6) null, "actual_entry_at" timestamptz(6) null, "entry_offset" jsonb null, "estimated_entry_at" timestamptz(6) null, "opens_publication_id" uuid null, "permission_profile" jsonb not null default '[]', "source_template_id" uuid null, "source_template_version" int4 null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_batch_phases_opens_publication" on "batch_phases" ("opens_publication_id") where opens_publication_id IS NOT NULL;

create unique index "uq_batch_phases_tenant_batch_ordinal" on "batch_phases" ("tenant_id", "batch_id", "ordinal");

create unique index "uq_batch_phases_tenant_id_id" on "batch_phases" ("tenant_id", "id");

create table "batch_user_types" ("tenant_id" uuid not null, "batch_id" uuid not null, "user_type_id" uuid not null, "created_at" timestamptz(6) not null default now(), constraint "pk_batch_user_types" primary key ("tenant_id", "batch_id", "user_type_id"));

create index "idx_batch_user_types_tenant_user_type" on "batch_user_types" ("tenant_id", "user_type_id");

create table "phase_events" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "phase_id" uuid not null, "kind" varchar(31) not null, "planned_at" timestamptz(6) null, "actual_at" timestamptz(6) null, "processed_at" timestamptz(6) null, "actor_id" uuid null, "reason" text null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_phase_events_tenant_phase_created" on "phase_events" ("tenant_id", "phase_id", "created_at");

create table "phase_item_scopes" ("tenant_id" uuid not null, "phase_id" uuid not null, "item_id" uuid not null, "created_at" timestamptz(6) not null default now(), constraint "pk_phase_item_scopes" primary key ("tenant_id", "phase_id", "item_id"));

create table "phase_participant_scopes" ("tenant_id" uuid not null, "phase_id" uuid not null, "participant_id" uuid not null, "created_at" timestamptz(6) not null default now(), constraint "pk_phase_participant_scopes" primary key ("tenant_id", "phase_id", "participant_id"));

create index "idx_phase_participant_scopes_tenant_participant" on "phase_participant_scopes" ("tenant_id", "participant_id");

create table "phase_templates" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "name" varchar(100) not null, "version" int4 not null default 1, "phases" jsonb not null default '[]', "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_phase_templates_tenant_name" on "phase_templates" ("tenant_id", "name");

alter table "assessment_batches" add constraint "assessment_batches_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "assessment_batches" add constraint "fk_assessment_batches_current_phase" foreign key ("tenant_id", "current_phase_id") references "batch_phases" ("tenant_id", "id") on update no action on delete set null (current_phase_id);

alter table "assessment_batches" add constraint "fk_assessment_batches_scope_node" foreign key ("tenant_id", "scope_node_id") references "org_nodes" ("tenant_id", "id") on update no action on delete restrict;

alter table "assessment_batches" add constraint "chk_assessment_batches_config_revision_non_negative" check (config_revision >= 0);

alter table "assessment_batches" add constraint "chk_assessment_batches_name_not_blank" check (btrim(name) <> ''::text);

alter table "assessment_batches" add constraint "chk_assessment_batches_status" check ("status" in ('draft', 'active', 'archived'));

alter table "assessment_batches" add constraint "chk_assessment_batches_timezone_not_blank" check (btrim(timezone) <> ''::text);

alter table "batch_config_revisions" add constraint "batch_config_revisions_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "batch_config_revisions" add constraint "fk_batch_config_revisions_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_config_revisions" add constraint "chk_batch_config_revisions_revision_positive" check (revision >= 1);

alter table "batch_participants" add constraint "batch_participants_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "batch_participants" add constraint "fk_batch_participants_anchor_node" foreign key ("tenant_id", "assessment_anchor_node_id") references "org_nodes" ("tenant_id", "id") on update no action on delete restrict;

alter table "batch_participants" add constraint "fk_batch_participants_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_participants" add constraint "fk_batch_participants_user" foreign key ("tenant_id", "user_id") references "users" ("tenant_id", "id") on update no action on delete restrict;

alter table "batch_participants" add constraint "fk_batch_participants_user_type" foreign key ("tenant_id", "user_type_id") references "user_types" ("tenant_id", "id") on update no action on delete restrict;

alter table "batch_participants" add constraint "chk_batch_participants_status" check ("status" in ('active', 'excluded'));

alter table "batch_phases" add constraint "batch_phases_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "batch_phases" add constraint "fk_batch_phases_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_phases" add constraint "chk_batch_phases_display_name_not_blank" check (btrim(display_name) <> ''::text);

alter table "batch_phases" add constraint "chk_batch_phases_entry_trigger" check ("entry_trigger" in ('scheduled', 'manual', 'publication'));

alter table "batch_phases" add constraint "chk_batch_phases_ordinal_non_negative" check (ordinal >= 0);

alter table "batch_phases" add constraint "chk_batch_phases_phase_key_format" check (phase_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);

alter table "batch_phases" add constraint "chk_batch_phases_publication_binding" check ((entry_trigger = 'publication'::text) OR (opens_publication_id IS NULL));

alter table "batch_user_types" add constraint "batch_user_types_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "batch_user_types" add constraint "fk_batch_user_types_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_user_types" add constraint "fk_batch_user_types_type" foreign key ("tenant_id", "user_type_id") references "user_types" ("tenant_id", "id") on update no action on delete restrict;

alter table "phase_events" add constraint "fk_phase_events_phase" foreign key ("tenant_id", "phase_id") references "batch_phases" ("tenant_id", "id") on update no action on delete cascade;

alter table "phase_events" add constraint "phase_events_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "phase_events" add constraint "chk_phase_events_kind_format" check (kind ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);

alter table "phase_item_scopes" add constraint "fk_phase_item_scopes_phase" foreign key ("tenant_id", "phase_id") references "batch_phases" ("tenant_id", "id") on update no action on delete cascade;

alter table "phase_item_scopes" add constraint "phase_item_scopes_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "phase_participant_scopes" add constraint "fk_phase_participant_scopes_participant" foreign key ("tenant_id", "participant_id") references "batch_participants" ("tenant_id", "id") on update no action on delete cascade;

alter table "phase_participant_scopes" add constraint "fk_phase_participant_scopes_phase" foreign key ("tenant_id", "phase_id") references "batch_phases" ("tenant_id", "id") on update no action on delete cascade;

alter table "phase_participant_scopes" add constraint "phase_participant_scopes_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "phase_templates" add constraint "phase_templates_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "phase_templates" add constraint "chk_phase_templates_name_not_blank" check (btrim(name) <> ''::text);

alter table "phase_templates" add constraint "chk_phase_templates_version_positive" check (version >= 1);
