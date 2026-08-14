alter table "assessment_items" drop constraint "chk_assessment_items_status";

alter table "assessment_items" drop constraint "chk_assessment_items_void_state_shape";

alter table "assessment_items" alter column "status" set default 'draft';

alter table "assessment_items" add constraint "chk_assessment_items_status" check ("status" in ('draft', 'active', 'voided'));

alter table "assessment_items" add constraint "chk_assessment_items_void_state_shape" check (((status <> 'voided'::text) AND (voided_at IS NULL) AND (voided_by IS NULL) AND (void_reason IS NULL)) OR ((status = 'voided'::text) AND (voided_at IS NOT NULL) AND (voided_by IS NOT NULL) AND (btrim(void_reason) <> ''::text)));
