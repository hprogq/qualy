-- owner: @qualy/plugin-assessment

-- The second route is an escalation, not a doubt (§32.64).
--
-- What the reviewer standing there is doing is handing on a matter they
-- cannot settle; "doubt" named it as something found about the person who
-- filed it, which is not what happens. The word is the same one the code and
-- both catalogs now use.
--
-- Only the values a query reads are rewritten here: the route a round stands
-- on, the route an event was said on, the action a phase opens, and the kind
-- of the event itself - which folds back into `escalated`, the kind rounds
-- were already recording under before the routes were split apart.
--
-- The frozen policy snapshots (`review_instances.effective_chain`) and the
-- item revisions that hold `reviewPolicy` are NOT rewritten. Those are
-- immutable by rule; the readers accept both names, which is the same seam
-- that already reads a policy written as one list with a marker in it.

-- the check has to go first: it still names the old value, and the rows are
-- being moved off it
alter table review_instances drop constraint if exists chk_review_instances_route;

update review_instances set current_route = 'escalation' where current_route = 'doubt';

update review_events set route = 'escalation' where route = 'doubt';

update review_events set kind = 'escalated' where kind = 'doubt-raised';

-- the profile is a jsonb array of codes, so the swap is element by element
update batch_phases
set permission_profile = (
      select jsonb_agg(
               case when code = '"assessment.review.raise-doubt"'::jsonb
                    then '"assessment.review.escalate"'::jsonb
                    else code end)
      from jsonb_array_elements(permission_profile) as code)
where permission_profile @> '["assessment.review.raise-doubt"]'::jsonb;

-- a template holds whole phases, each with a profile of its own
update phase_templates
set phases = replace(phases::text,
      '"assessment.review.raise-doubt"', '"assessment.review.escalate"')::jsonb
where phases::text like '%assessment.review.raise-doubt%';

alter table review_instances
  add constraint chk_review_instances_route check (current_route in ('normal', 'escalation'));
