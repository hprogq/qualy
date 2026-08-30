-- owner: @qualy/plugin-assessment

-- What an appeal is contesting, when no round produced it.
--
-- An administrative record is a determination made without a review: the
-- office writes it, it is approved on the spot, and there is no round to
-- name. Until now that meant a student could not disagree with it at all -
-- the appeal door asked for a review instance - while being perfectly able
-- to abandon it, which is the wrong way round for a penalty.
--
-- An appeal against one of those names the determination instead. Nullable
-- because most appeals still contest a round, and a round says what it
-- determined on its own.
alter table review_instances add column appealed_recognition_id uuid null;

alter table review_instances add constraint fk_review_instances_appealed_recognition
  foreign key (tenant_id, entry_id, appealed_recognition_id)
  references entry_recognitions (tenant_id, entry_id, id) on delete restrict;

-- one or the other, never both: a round is contested by naming the round
alter table review_instances add constraint chk_review_instances_appealed_one
  check (appealed_instance_id is null or appealed_recognition_id is null);
