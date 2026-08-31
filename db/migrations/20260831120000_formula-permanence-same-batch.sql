-- owner: @qualy/plugin-assessment
-- A published formula version is a permanent execution fact: its function
-- edge becomes RESTRICT, so dropping a function with versions is refused
-- (tenant deletion still cascades whole - restrict judges the statement's
-- final state). The two batch-scoped references gain their batch column,
-- so citing a row from another round is a 23503 instead of a service-layer
-- promise. The unique index comes first: it is the target the same-batch
-- current-phase reference needs.

create unique index "uq_batch_phases_tenant_batch_id" on "batch_phases" ("tenant_id", "batch_id", "id");

alter table "assessment_batches" drop constraint "fk_assessment_batches_current_phase";

alter table "assessment_formula_versions" drop constraint "fk_assessment_formula_versions_function";

alter table "batch_participant_events" drop constraint "fk_batch_participant_events_participant";

alter table "assessment_batches" add constraint "fk_assessment_batches_current_phase" foreign key ("tenant_id", "id", "current_phase_id") references "batch_phases" ("tenant_id", "batch_id", "id") on update no action on delete set null (current_phase_id);

alter table "assessment_formula_versions" add constraint "fk_assessment_formula_versions_function" foreign key ("tenant_id", "function_id") references "assessment_formula_functions" ("tenant_id", "id") on update no action on delete restrict;

alter table "batch_participant_events" add constraint "fk_batch_participant_events_participant" foreign key ("tenant_id", "batch_id", "participant_id") references "batch_participants" ("tenant_id", "batch_id", "id") on update no action on delete cascade;
