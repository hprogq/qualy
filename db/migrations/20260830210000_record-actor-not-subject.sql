-- owner: @qualy/plugin-assessment

-- A record is one person writing a fact about another.
--
-- The service refuses a registrar recording against themselves; this says
-- the same thing where every writer has to hear it - a migration, an
-- import, a future path that forgets. A student's own filing is exactly the
-- opposite case, so the check binds only the sources nobody files for
-- themselves.
alter table entry_revisions add constraint chk_entry_revisions_record_two_people
  check ((source <> 'record' and source <> 'import') or actor_id <> subject_id);

-- And the round an appeal contests is pinned, not nulled: the check above
-- it demands an appeal name exactly one target, so SET NULL could never
-- have completed a delete anyway - it would have traded a foreign key
-- refusal for a check refusal halfway through. Say the intended thing.
alter table review_instances drop constraint fk_review_instances_appealed;
alter table review_instances add constraint fk_review_instances_appealed
  foreign key (tenant_id, entry_id, appealed_instance_id)
  references review_instances (tenant_id, entry_id, id) on delete restrict;
