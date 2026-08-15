-- owner: @qualy/plugin-assessment

-- Which version of a question's review policy a round is walking, said out
-- loud instead of inferred from the filing under judgment (§32.62).
--
-- They were the same fact until now: a round resolved its route from the
-- item revision the judged entry revision cited. Separating them is what
-- lets an administrator fix a level nobody holds by editing the question -
-- the next round follows the procedure in force when it opens, while what
-- is being judged stays exactly the filing that was made.
--
-- Rounds already open get the version they actually walked, which is that
-- same cited item revision. Nothing about them changes; the fact is simply
-- written down where it can be read.

alter table review_instances add column policy_revision_id uuid;

update review_instances ri
set policy_revision_id = er.item_revision_id
from entry_revisions er
where er.tenant_id = ri.tenant_id
  and er.id = ri.revision_id;

alter table review_instances alter column policy_revision_id set not null;

alter table review_instances
  add constraint fk_review_instances_policy_revision
  foreign key (tenant_id, policy_revision_id)
  references assessment_item_revisions (tenant_id, id) on delete restrict;
