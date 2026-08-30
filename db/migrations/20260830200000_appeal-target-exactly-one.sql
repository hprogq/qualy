-- owner: @qualy/plugin-assessment

-- An appeal contests exactly one thing, and only an appeal contests.
--
-- The first check only forbade naming both; it still admitted an appeal
-- naming neither - a round that says it is contesting without saying what -
-- and an ordinary round carrying a target. The service never writes either,
-- but this table is also written by migrations and will be read by whatever
-- comes later, and "what is this appeal about" should not depend on every
-- writer staying careful.
alter table review_instances drop constraint chk_review_instances_appealed_one;
alter table review_instances add constraint chk_review_instances_appealed_one
  check (
    (origin = 'appeal' and ((appealed_instance_id is null) <> (appealed_recognition_id is null)))
    or (origin <> 'appeal' and appealed_instance_id is null and appealed_recognition_id is null)
  );

-- and the contested round belongs to the same claim, said by the key rather
-- than trusted: a pointer across entries would inherit somebody else's
-- determination
alter table review_instances drop constraint fk_review_instances_appealed;
alter table review_instances add constraint fk_review_instances_appealed
  foreign key (tenant_id, entry_id, appealed_instance_id)
  references review_instances (tenant_id, entry_id, id) on delete set null (appealed_instance_id);
