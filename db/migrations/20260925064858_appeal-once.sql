-- One participant appeal per conclusion, and the targets a staff reopening
-- and an appeal against a revocation name (rulings of 2026-09-25). Only an
-- appeal that reached a conclusion is counted: one the system ended (a
-- voided question, an excluded participant, a re-determination, a reroute
-- that replaced it) spent nothing, so the indexes hold completed appeal
-- rounds that approved or rejected, whichever round of a rerouted chain
-- that was.
create unique index "uq_entry_events_tenant_entry_id" on "entry_events" ("tenant_id", "entry_id", "id");

alter table "entry_recognitions" drop constraint "chk_entry_recognitions_source";

alter table "entry_recognitions" add constraint "chk_entry_recognitions_source" check ("source" in ('review', 'record', 'import', 'system', 'redetermination'));

alter table "review_instances" add "appealed_event_id" uuid null;

alter table "review_instances" drop constraint "chk_review_instances_appealed_one";

alter table "review_instances" add constraint "chk_review_instances_appealed_one" check (((origin = 'appeal' OR origin = 'reopen') AND num_nonnulls(appealed_instance_id, appealed_recognition_id, appealed_event_id) = 1) OR (origin <> 'appeal' AND origin <> 'reopen' AND appealed_instance_id IS NULL AND appealed_recognition_id IS NULL AND appealed_event_id IS NULL));

alter table "review_instances" add constraint "fk_review_instances_appealed_event" foreign key ("tenant_id", "entry_id", "appealed_event_id") references "entry_events" ("tenant_id", "entry_id", "id") on update no action on delete restrict;

create unique index "uq_review_instances_appeal_of_event" on "review_instances" ("tenant_id", "appealed_event_id") where ((origin)::text = 'appeal'::text) AND ((state)::text = 'completed'::text) AND ((outcome)::text = ANY ((ARRAY['approved'::character varying, 'rejected'::character varying])::text[]));

create unique index "uq_review_instances_appeal_of_instance" on "review_instances" ("tenant_id", "appealed_instance_id") where ((origin)::text = 'appeal'::text) AND ((state)::text = 'completed'::text) AND ((outcome)::text = ANY ((ARRAY['approved'::character varying, 'rejected'::character varying])::text[]));

create unique index "uq_review_instances_appeal_of_recognition" on "review_instances" ("tenant_id", "appealed_recognition_id") where ((origin)::text = 'appeal'::text) AND ((state)::text = 'completed'::text) AND ((outcome)::text = ANY ((ARRAY['approved'::character varying, 'rejected'::character varying])::text[]));
