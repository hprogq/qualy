-- destructive: approved
-- owner: @qualy/plugin-assessment

-- Two routes instead of one list with a marker in it, and a round that names
-- the step it stands at instead of pointing at a position (§32.62).
--
-- The stored policy is not rewritten: an item revision is immutable, and the
-- reader upgrades a one-list policy to two routes deterministically - split
-- at normalTerminal, each step named `legacy-<its index in the one list>`.
-- The backfill below derives the same names from the same numbers, so a
-- round standing at position 2 still finds position 2 after this runs.
--
-- One state has no home in the new model: a round that had escalated but was
-- still standing at or before the marker. In the old model escalation walked
-- the rest of the same list, ordinary steps included; in the new one raising
-- a doubt leaves the ordinary route entirely. Such a round keeps the step it
-- is standing at and lands on the ordinary route - the least-lossy reading,
-- and the only one that does not move a round to a level nobody sent it to.

alter table review_instances
  add column current_route varchar(16) not null default 'normal',
  add column current_stage_id varchar(63);

update review_instances
set current_route = case
      when current_stage_index > coalesce((effective_chain ->> 'normalTerminal')::int, 0)
        then 'doubt'
      else 'normal'
    end,
    current_stage_id = coalesce(
      effective_chain -> 'stages' -> current_stage_index ->> 'id',
      'legacy-' || current_stage_index::text
    );

alter table review_instances
  alter column current_stage_id set not null;

alter table review_instances
  drop constraint if exists chk_review_instances_mode,
  drop constraint if exists chk_review_instances_stage_non_negative,
  drop column mode,
  drop column current_stage_index,
  add constraint chk_review_instances_route check (current_route in ('normal', 'doubt'));

-- where a thing was said. Null on everything recorded before rounds had two
-- routes, and on events that belong to the round rather than to a step.
alter table review_events
  add column route varchar(16),
  add column stage_id varchar(63);
