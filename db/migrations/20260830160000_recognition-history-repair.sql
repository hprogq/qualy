-- owner: @qualy/plugin-assessment

-- One determination per decision, and every decision.
--
-- The history backfill read "approved" too widely and "approved
-- automatically" too narrowly, in the same pass.
--
-- Too widely: a round on a two-step ladder writes an approved event at each
-- step, but only the word that ENDS the round produces a formal
-- determination - the step below it confirms and hands the claim upward.
-- Backfilling one determination per approved event turned every multi-step
-- round in the archive into a stack of formal recognitions the same round
-- would produce exactly one of today.
--
-- Too narrowly: a claim may be approved automatically more than once - sent
-- back, refiled, approved by the rule again - and only the last of those
-- events was recovered, so the earlier ones left no determination at all.
--
-- Neither shows up in a world whose only determination is the empty one.
-- Both would be permanent once determinations carry values, which is why
-- this runs before they do.

-- 1. The stack collapses to the word that ended the round.
--
-- Runtime writes a determination only at the terminal approval, so any
-- determination on an earlier approved event of a completed round can only
-- have come from the backfill. The pointer moves off them first: it may be
-- sitting on one that is about to go.
create temporary table repair_surplus on commit drop as
select r.id, r.tenant_id, r.entry_id
from entry_recognitions r
join review_events ev
  on ev.tenant_id = r.tenant_id and ev.id = r.review_event_id
join review_instances ri
  on ri.tenant_id = ev.tenant_id and ri.id = ev.review_instance_id
where ri.state = 'completed'
  and ri.outcome = 'approved'
  and ev.kind = 'approved'
  and ev.id <> (
    select last.id
    from review_events last
    where last.tenant_id = ri.tenant_id
      and last.review_instance_id = ri.id
      and last.kind = 'approved'
    order by last.created_at desc, last.id desc
    limit 1
  );

update entries e
set current_recognition_id = null
where exists (
  select 1 from repair_surplus s
  where s.tenant_id = e.tenant_id and s.id = e.current_recognition_id
);

-- the chain is rebuilt below, so it is enough here to unhook the links
-- pointing at rows that are leaving
update entry_recognitions r
set supersedes_id = null
where exists (
  select 1 from repair_surplus s
  where s.tenant_id = r.tenant_id and s.id = r.supersedes_id
);

delete from entry_recognitions r
using repair_surplus s
where s.tenant_id = r.tenant_id and s.id = r.id;

-- 2. Every automatic approval, not only the most recent one.
--
-- The revision in force at that moment is the newest one created by then,
-- because a question's current revision only ever moves forward; the filing
-- is the newest one written by then, for the same reason. A moment neither
-- can be recovered for is left alone rather than given an invented one.
insert into entry_recognitions (
  tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
  values, source, created_by, created_at
)
select e.tenant_id, e.batch_id, e.id, er.id, e.item_id, ir.id,
       '{}'::jsonb, 'system', ee.actor_id, ee.created_at
from entry_events ee
join entries e on e.tenant_id = ee.tenant_id and e.id = ee.entry_id
join lateral (
  select r.id
  from assessment_item_revisions r
  where r.tenant_id = e.tenant_id
    and r.item_id = e.item_id
    and r.created_at <= ee.created_at
  order by r.revision_no desc
  limit 1
) ir on true
join lateral (
  select rv.id
  from entry_revisions rv
  where rv.tenant_id = e.tenant_id
    and rv.entry_id = e.id
    and rv.created_at <= ee.created_at
  order by rv.created_at desc
  limit 1
) rv_pick on true
join entry_revisions er on er.tenant_id = e.tenant_id and er.id = rv_pick.id
where ee.kind = 'auto-approved'
  and not exists (
    select 1 from entry_recognitions r
    where r.tenant_id = e.tenant_id
      and r.entry_id = e.id
      and r.source = 'system'
      and r.created_at = ee.created_at
  );

-- 3. The trail is one line again, in the order things happened, and each
-- claim points at the end of its own.
--
-- Two statements, because "one determination has at most one successor" is a
-- plain unique index and a single UPDATE checks it row by row. Inserting a
-- determination between two that were already chained means one link has to
-- be released before the other can be taken, and nothing about a set-based
-- UPDATE says which row it reaches first: the same statement succeeds or
-- fails depending on physical order. So every link that is about to move is
-- let go first, and only then is the chain laid down.
create temporary table repair_chain on commit drop as
select id,
       tenant_id,
       lag(id) over (partition by tenant_id, entry_id order by created_at, id) as previous
from entry_recognitions;

update entry_recognitions r
set supersedes_id = null
from repair_chain c
where c.id = r.id and c.tenant_id = r.tenant_id
  and r.supersedes_id is distinct from c.previous;

update entry_recognitions r
set supersedes_id = c.previous
from repair_chain c
where c.id = r.id and c.tenant_id = r.tenant_id
  and c.previous is not null
  and r.supersedes_id is null;

update entries e
set current_recognition_id = (
  select r.id
  from entry_recognitions r
  where r.tenant_id = e.tenant_id and r.entry_id = e.id
  order by r.created_at desc, r.id desc
  limit 1
)
where exists (
  select 1 from entry_recognitions r
  where r.tenant_id = e.tenant_id and r.entry_id = e.id
)
and e.current_recognition_id is distinct from (
  select r.id
  from entry_recognitions r
  where r.tenant_id = e.tenant_id and r.entry_id = e.id
  order by r.created_at desc, r.id desc
  limit 1
);
