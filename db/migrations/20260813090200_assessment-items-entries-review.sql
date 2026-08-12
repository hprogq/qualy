-- the entries same-batch participant reference needs this key on an M1 table,
-- so it comes before the tables that cite it
create unique index "uq_batch_participants_tenant_batch_id" on "batch_participants" ("tenant_id", "batch_id", "id");

create table "assessment_item_revisions" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "item_id" uuid not null, "revision_no" int4 not null, "entry_source" varchar(31) not null, "form_config" jsonb not null, "scoring_config" jsonb not null, "review_policy" jsonb not null, "display_config" jsonb not null, "created_by" uuid not null, "reason" varchar(500) null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_assessment_item_revisions_tenant_id_id" on "assessment_item_revisions" ("tenant_id", "id");

create unique index "uq_assessment_item_revisions_tenant_item_id" on "assessment_item_revisions" ("tenant_id", "item_id", "id");

create unique index "uq_assessment_item_revisions_tenant_item_no" on "assessment_item_revisions" ("tenant_id", "item_id", "revision_no");

create table "assessment_items" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "item_type" varchar(63) not null, "title" varchar(255) not null, "current_revision_id" uuid null, "score_group_id" uuid not null, "max_entries" int4 null, "sort_order" int4 not null default 0, "status" varchar(16) not null default 'active', "voided_at" timestamptz(6) null, "voided_by" uuid null, "void_reason" varchar(500) null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_assessment_items_tenant_batch_group" on "assessment_items" ("tenant_id", "batch_id", "score_group_id", "sort_order");

create unique index "uq_assessment_items_tenant_batch_id" on "assessment_items" ("tenant_id", "batch_id", "id");

create unique index "uq_assessment_items_tenant_id_id" on "assessment_items" ("tenant_id", "id");

create table "entries" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "item_id" uuid not null, "participant_id" uuid not null, "current_revision_id" uuid null, "current_review_instance_id" uuid null, "status" varchar(16) not null default 'draft', "source" varchar(16) not null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_entries_tenant_batch_item_status" on "entries" ("tenant_id", "batch_id", "item_id", "status");

create index "idx_entries_tenant_batch_participant_item" on "entries" ("tenant_id", "batch_id", "participant_id", "item_id");

create unique index "uq_entries_tenant_id_id" on "entries" ("tenant_id", "id");

create table "entry_revision_attachments" ("tenant_id" uuid not null, "revision_id" uuid not null, "attachment_id" uuid not null, "position" int4 not null, constraint "pk_entry_revision_attachments" primary key ("tenant_id", "revision_id", "attachment_id"));

create index "idx_entry_revision_attachments_tenant_attachment" on "entry_revision_attachments" ("tenant_id", "attachment_id");

CREATE UNIQUE INDEX uq_entry_revision_attachments_tenant_revision_position ON public.entry_revision_attachments USING btree (tenant_id, revision_id, "position");

create table "entry_revisions" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "entry_id" uuid not null, "item_revision_id" uuid not null, "revision_no" int4 not null, "payload" jsonb not null, "actor_id" uuid not null, "subject_id" uuid not null, "source" varchar(16) not null, "note" varchar(500) null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_entry_revisions_tenant_entry_id" on "entry_revisions" ("tenant_id", "entry_id", "id");

create unique index "uq_entry_revisions_tenant_entry_no" on "entry_revisions" ("tenant_id", "entry_id", "revision_no");

create unique index "uq_entry_revisions_tenant_id_id" on "entry_revisions" ("tenant_id", "id");

create table "review_events" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "review_instance_id" uuid not null, "kind" varchar(31) not null, "actor_id" uuid null, "comment" text null, "suggested_payload" jsonb null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_review_events_tenant_instance_created" on "review_events" ("tenant_id", "review_instance_id", "created_at");

create table "review_instances" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "entry_id" uuid not null, "revision_id" uuid not null, "round_no" int4 not null, "origin" varchar(16) not null, "initiator" varchar(16) not null, "effective_chain" jsonb not null, "mode" varchar(16) not null default 'normal', "current_stage_index" int4 not null default 0, "state" varchar(16) not null default 'active', "outcome" varchar(31) null, "current_role_ids" uuid[] not null, "current_node_id" uuid not null, "current_node_path" ltree not null, "created_at" timestamptz(6) not null default now(), "completed_at" timestamptz(6) null, primary key ("id"));

create index "idx_review_instances_inbox" on "review_instances" ("tenant_id", "state", "current_node_id");

create unique index "uq_review_instances_open_entry" on "review_instances" ("entry_id") where (state)::text = ANY ((ARRAY['active'::character varying, 'blocked'::character varying])::text[]);

create unique index "uq_review_instances_tenant_entry_id" on "review_instances" ("tenant_id", "entry_id", "id");

create unique index "uq_review_instances_tenant_entry_round" on "review_instances" ("tenant_id", "entry_id", "round_no");

create unique index "uq_review_instances_tenant_id_id" on "review_instances" ("tenant_id", "id");

create table "score_groups" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "parent_group_id" uuid null, "name" varchar(255) not null, "cap" numeric(12,4) null, "floor" numeric(12,4) null, "sort_order" int4 not null default 0, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_score_groups_tenant_batch_sort" on "score_groups" ("tenant_id", "batch_id", "sort_order");

create unique index "uq_score_groups_tenant_batch_id" on "score_groups" ("tenant_id", "batch_id", "id");

create unique index "uq_score_groups_tenant_id_id" on "score_groups" ("tenant_id", "id");

alter table "assessment_item_revisions" add constraint "assessment_item_revisions_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "assessment_item_revisions" add constraint "fk_assessment_item_revisions_item" foreign key ("tenant_id", "item_id") references "assessment_items" ("tenant_id", "id") on update no action on delete cascade;

alter table "assessment_item_revisions" add constraint "chk_assessment_item_revisions_entry_source" check ("entry_source" in ('student', 'administrative'));

alter table "assessment_item_revisions" add constraint "chk_assessment_item_revisions_no_positive" check (revision_no >= 1);

alter table "assessment_items" add constraint "assessment_items_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "assessment_items" add constraint "fk_assessment_items_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "assessment_items" add constraint "fk_assessment_items_current_revision" foreign key ("tenant_id", "id", "current_revision_id") references "assessment_item_revisions" ("tenant_id", "item_id", "id") on update no action on delete set null (current_revision_id);

alter table "assessment_items" add constraint "fk_assessment_items_score_group" foreign key ("tenant_id", "batch_id", "score_group_id") references "score_groups" ("tenant_id", "batch_id", "id") on update no action on delete restrict;

alter table "assessment_items" add constraint "chk_assessment_items_item_type_format" check (item_type ~ '^[a-z0-9]+(?:[.-][a-z0-9]+)*$'::text);

alter table "assessment_items" add constraint "chk_assessment_items_max_entries_positive" check ((max_entries IS NULL) OR (max_entries >= 1));

alter table "assessment_items" add constraint "chk_assessment_items_status" check ("status" in ('active', 'voided'));

alter table "assessment_items" add constraint "chk_assessment_items_title_not_blank" check (btrim(title) <> ''::text);

alter table "assessment_items" add constraint "chk_assessment_items_voided_shape" check ((status = 'voided'::text) = ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL) AND (void_reason IS NOT NULL)));

alter table "entries" add constraint "entries_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "entries" add constraint "fk_entries_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "entries" add constraint "fk_entries_current_review_instance" foreign key ("tenant_id", "id", "current_review_instance_id") references "review_instances" ("tenant_id", "entry_id", "id") on update no action on delete set null (current_review_instance_id);

alter table "entries" add constraint "fk_entries_current_revision" foreign key ("tenant_id", "id", "current_revision_id") references "entry_revisions" ("tenant_id", "entry_id", "id") on update no action on delete set null (current_revision_id);

alter table "entries" add constraint "fk_entries_item" foreign key ("tenant_id", "batch_id", "item_id") references "assessment_items" ("tenant_id", "batch_id", "id") on update no action on delete restrict;

alter table "entries" add constraint "fk_entries_participant" foreign key ("tenant_id", "batch_id", "participant_id") references "batch_participants" ("tenant_id", "batch_id", "id") on update no action on delete restrict;

alter table "entries" add constraint "chk_entries_source" check ("source" in ('self', 'proxy', 'record', 'import', 'system'));

alter table "entries" add constraint "chk_entries_status" check ("status" in ('draft', 'in_review', 'approved', 'rejected', 'voided'));

alter table "entry_revision_attachments" add constraint "entry_revision_attachments_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "entry_revision_attachments" add constraint "fk_entry_revision_attachments_attachment" foreign key ("tenant_id", "attachment_id") references "storage_attachments" ("tenant_id", "id") on update no action on delete restrict;

alter table "entry_revision_attachments" add constraint "fk_entry_revision_attachments_revision" foreign key ("tenant_id", "revision_id") references "entry_revisions" ("tenant_id", "id") on update no action on delete cascade;

alter table "entry_revision_attachments" add constraint "chk_entry_revision_attachments_position_non_negative" check ("position" >= 0);

alter table "entry_revisions" add constraint "entry_revisions_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "entry_revisions" add constraint "fk_entry_revisions_entry" foreign key ("tenant_id", "entry_id") references "entries" ("tenant_id", "id") on update no action on delete cascade;

alter table "entry_revisions" add constraint "fk_entry_revisions_item_revision" foreign key ("tenant_id", "item_revision_id") references "assessment_item_revisions" ("tenant_id", "id") on update no action on delete restrict;

alter table "entry_revisions" add constraint "chk_entry_revisions_no_positive" check (revision_no >= 1);

alter table "entry_revisions" add constraint "chk_entry_revisions_source" check ("source" in ('self', 'proxy', 'record', 'import', 'system'));

alter table "review_events" add constraint "fk_review_events_instance" foreign key ("tenant_id", "review_instance_id") references "review_instances" ("tenant_id", "id") on update no action on delete cascade;

alter table "review_events" add constraint "review_events_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "review_events" add constraint "chk_review_events_kind_format" check (kind ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);

alter table "review_instances" add constraint "fk_review_instances_entry" foreign key ("tenant_id", "entry_id") references "entries" ("tenant_id", "id") on update no action on delete cascade;

alter table "review_instances" add constraint "fk_review_instances_revision" foreign key ("tenant_id", "entry_id", "revision_id") references "entry_revisions" ("tenant_id", "entry_id", "id") on update no action on delete cascade;

alter table "review_instances" add constraint "review_instances_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "review_instances" add constraint "chk_review_instances_completed_shape" check ((state = 'completed'::text) = (completed_at IS NOT NULL));

alter table "review_instances" add constraint "chk_review_instances_initiator" check ("initiator" in ('participant', 'staff'));

alter table "review_instances" add constraint "chk_review_instances_mode" check ("mode" in ('normal', 'escalated'));

alter table "review_instances" add constraint "chk_review_instances_origin" check ("origin" in ('initial', 'appeal', 'reopen'));

alter table "review_instances" add constraint "chk_review_instances_outcome_only_completed" check ((outcome IS NULL) OR (state = 'completed'::text));

alter table "review_instances" add constraint "chk_review_instances_round_positive" check (round_no >= 1);

alter table "review_instances" add constraint "chk_review_instances_stage_non_negative" check (current_stage_index >= 0);

alter table "review_instances" add constraint "chk_review_instances_state" check ("state" in ('active', 'blocked', 'completed'));

alter table "score_groups" add constraint "fk_score_groups_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "score_groups" add constraint "fk_score_groups_parent" foreign key ("tenant_id", "batch_id", "parent_group_id") references "score_groups" ("tenant_id", "batch_id", "id") on update no action on delete restrict;

alter table "score_groups" add constraint "score_groups_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "score_groups" add constraint "chk_score_groups_name_not_blank" check (btrim(name) <> ''::text);

