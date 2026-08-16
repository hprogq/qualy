-- owner: @qualy/plugin-assessment

-- An appeal is a round against a decision, walking the doubt route with only
-- its last step able to end it (§32.63). Both facts are frozen on the round:
-- which decision is being contested, and where it may be ended.
--
-- Every round that already exists is an ordinary submission, so any-stage is
-- what they were all running under and what the default gives them.

alter table "review_instances" add "appealed_instance_id" uuid null, add "reject_policy" varchar(16) not null default 'any-stage';

alter table "review_instances" add constraint "fk_review_instances_appealed" foreign key ("tenant_id", "appealed_instance_id") references "review_instances" ("tenant_id", "id") on update no action on delete set null (appealed_instance_id);

alter table "review_instances" add constraint "chk_review_instances_reject_policy" check ("reject_policy" in ('any-stage', 'terminal-only'));
