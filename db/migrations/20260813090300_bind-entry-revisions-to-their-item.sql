alter table "entry_revisions" drop constraint "fk_entry_revisions_item_revision";

alter table "assessment_items" drop constraint "chk_assessment_items_voided_shape";

alter table "assessment_items" add constraint "chk_assessment_items_void_state_shape" check (((status = 'active'::text) AND (voided_at IS NULL) AND (voided_by IS NULL) AND (void_reason IS NULL)) OR ((status = 'voided'::text) AND (voided_at IS NOT NULL) AND (voided_by IS NOT NULL) AND (btrim(void_reason) <> ''::text)));

create unique index "uq_entries_tenant_id_item" on "entries" ("tenant_id", "id", "item_id");

alter table "entry_revisions" add "item_id" uuid not null;

alter table "entry_revisions" add constraint "fk_entry_revisions_entry_item" foreign key ("tenant_id", "entry_id", "item_id") references "entries" ("tenant_id", "id", "item_id") on update no action on delete cascade;

alter table "entry_revisions" add constraint "fk_entry_revisions_item_revision" foreign key ("tenant_id", "item_id", "item_revision_id") references "assessment_item_revisions" ("tenant_id", "item_id", "id") on update no action on delete restrict;

alter table "review_instances" drop constraint "chk_review_instances_completed_shape";

alter table "review_instances" drop constraint "chk_review_instances_outcome_only_completed";

alter table "review_instances" add constraint "chk_review_instances_lifecycle_shape" check (((state <> 'completed'::text) AND (completed_at IS NULL) AND (outcome IS NULL)) OR ((state = 'completed'::text) AND (completed_at IS NOT NULL) AND (outcome IS NOT NULL)));

alter table "score_groups" add constraint "chk_score_groups_floor_le_cap" check ((floor IS NULL) OR (cap IS NULL) OR (floor <= cap));
