-- owner: @qualy/plugin-assessment

-- The determination trail, made whole.
--
-- The backfill that created it answered one question - "can every approved
-- claim still be scored" - and answered it correctly. It did not answer the
-- one the table was actually built to answer: what has this institution
-- determined about this claim, ever. Four corrections, none of which can be
-- made by editing the migration that ran.

-- 1. Which approval is the one this claim currently stands on.
--
-- The original CASE preferred review whenever a completed approved round
-- existed anywhere in the claim's history. But a claim may be approved by a
-- reviewer, sent back, and then - after an administrator switches the
-- question to needing no review at all - approved by the rule instead. The
-- standing decision there is the automatic one, and naming the older round
-- attributes the current recognition to a reviewer who did not make it.
update entry_recognitions r
set source = 'system',
    review_instance_id = null,
    review_event_id = null,
    item_revision_id = auto.item_revision_id,
    created_at = auto.event_at,
    created_by = auto.actor_id
from entries e
join lateral (
  select ee.created_at as event_at,
         ee.actor_id,
         (
           select ir.id
           from assessment_item_revisions ir
           where ir.tenant_id = e.tenant_id
             and ir.item_id = e.item_id
             and ir.created_at <= ee.created_at
           order by ir.revision_no desc
           limit 1
         ) as item_revision_id
  from entry_events ee
  where ee.tenant_id = e.tenant_id
    and ee.entry_id = e.id
    and ee.kind = 'auto-approved'
  order by ee.created_at desc
  limit 1
) auto on true
where r.tenant_id = e.tenant_id
  and r.entry_id = e.id
  and r.source = 'review'
  and auto.item_revision_id is not null
  -- the automatic approval came after the round's word: it is the later
  -- fact, and the later fact is the one in force
  and auto.event_at > r.created_at;

-- 2. Every approval, not only the standing one.
--
-- A claim approved in May, appealed in June and still under review today
-- has an approval in its history and had nothing in this table: the round
-- said "approved" and the record of what it determined was missing. Since
-- the only recognition the old world could hold is the empty one, every
-- historical approval can be recovered exactly, with the round and the word
-- that made it, and chained in the order they happened.
with said as (
  select ev.tenant_id,
         e.batch_id,
         e.id as entry_id,
         ri.revision_id as entry_revision_id,
         e.item_id,
         ri.recognition_revision_id as item_revision_id,
         ri.id as review_instance_id,
         ev.id as review_event_id,
         ev.actor_id,
         ev.created_at,
         row_number() over (partition by e.id order by ev.created_at, ev.id) as seq
  from review_events ev
  join review_instances ri
    on ri.tenant_id = ev.tenant_id and ri.id = ev.review_instance_id
  join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
  where ev.kind = 'approved'
    and ri.state = 'completed'
    and ri.outcome = 'approved'
    -- the standing determination is already recorded, with this same round
    and not exists (
      select 1 from entry_recognitions r
      where r.tenant_id = ev.tenant_id and r.review_event_id = ev.id
    )
)
insert into entry_recognitions (
  tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
  values, source, review_instance_id, review_event_id, created_by, created_at
)
select tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
       '{}'::jsonb, 'review', review_instance_id, review_event_id, actor_id, created_at
from said;

-- and the same for approvals that no reviewer made: a claim automatically
-- approved, later sent back, and now sitting in some other state
insert into entry_recognitions (
  tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
  values, source, created_by, created_at
)
select e.tenant_id, e.batch_id, e.id, er.id, e.item_id, auto.item_revision_id,
       '{}'::jsonb, 'system', auto.actor_id, auto.event_at
from entries e
join lateral (
  select ee.created_at as event_at,
         ee.actor_id,
         (
           select ir.id
           from assessment_item_revisions ir
           where ir.tenant_id = e.tenant_id
             and ir.item_id = e.item_id
             and ir.created_at <= ee.created_at
           order by ir.revision_no desc
           limit 1
         ) as item_revision_id
  from entry_events ee
  where ee.tenant_id = e.tenant_id
    and ee.entry_id = e.id
    and ee.kind = 'auto-approved'
  order by ee.created_at desc
  limit 1
) auto on true
join lateral (
  select rv.id
  from entry_revisions rv
  where rv.tenant_id = e.tenant_id
    and rv.entry_id = e.id
    and rv.created_at <= auto.event_at
  order by rv.created_at desc
  limit 1
) er on true
where auto.item_revision_id is not null
  and not exists (
    select 1 from entry_recognitions r
    where r.tenant_id = e.tenant_id
      and r.entry_id = e.id
      and r.source = 'system'
      and r.created_at = auto.event_at
  );

-- one line per claim, oldest first: a determination points at the one it
-- replaced, so an appeal reads as a history rather than as a single value
with chained as (
  select id,
         tenant_id,
         lag(id) over (partition by tenant_id, entry_id order by created_at, id) as previous
  from entry_recognitions
)
update entry_recognitions r
set supersedes_id = chained.previous
from chained
where chained.id = r.id and chained.tenant_id = r.tenant_id
  and chained.previous is not null
  and r.supersedes_id is distinct from chained.previous;

-- and the claim points at the last one, whatever it stands at today: a
-- rejected claim still has a determination in its past, and the scorer
-- ignores it by reading the status rather than by the pointer being empty
update entries e
set current_recognition_id = (
  select r.id
  from entry_recognitions r
  where r.tenant_id = e.tenant_id and r.entry_id = e.id
  order by r.created_at desc, r.id desc
  limit 1
)
where e.current_recognition_id is null
  and exists (
    select 1 from entry_recognitions r
    where r.tenant_id = e.tenant_id and r.entry_id = e.id
  );

-- 3. A sitting that was open when the table arrived votes on one proposal
-- like every other. Its ballots were cast before there was anything to
-- freeze, and in the old world the only proposal there could be is the
-- empty one, so the sitting can be given its frozen text and every ballot
-- already cast pointed at it.
alter table review_panels add column recognition_reason text null;

update review_panels p
set recognition_payload = '{}'::jsonb,
    recognition_hash = encode(sha256('{}'::bytea), 'hex'),
    recognition_locked_at = (
      select min(v.created_at) from review_votes v
      where v.tenant_id = p.tenant_id and v.panel_id = p.id
    )
where p.recognition_locked_at is null
  and exists (
    select 1 from review_votes v
    where v.tenant_id = p.tenant_id and v.panel_id = p.id
  );

update review_votes v
set recognition_hash = p.recognition_hash
from review_panels p
where p.tenant_id = v.tenant_id and p.id = v.panel_id
  and v.recognition_hash is null
  and p.recognition_hash is not null;

-- 4. A determination cannot lose the review that made it.
--
-- The shape check says a review determination names its round and its word;
-- the foreign keys said those columns become null when the row they name
-- goes. Both cannot be true, and deleting a review event would have failed
-- on the check rather than doing either. The provenance is the point of the
-- row, so it pins what it cites: a batch or tenant going away still takes
-- the whole chain with it through their own cascades.
alter table entry_recognitions drop constraint fk_entry_recognitions_review_instance;
alter table entry_recognitions drop constraint fk_entry_recognitions_review_event;
alter table entry_recognitions add constraint fk_entry_recognitions_review_instance
  foreign key (tenant_id, entry_id, review_instance_id)
  references review_instances (tenant_id, entry_id, id) on delete restrict;
alter table entry_recognitions add constraint fk_entry_recognitions_review_event
  foreign key (tenant_id, review_instance_id, review_event_id)
  references review_events (tenant_id, review_instance_id, id) on delete restrict;

-- One word, one determination; one determination, one successor. The trail
-- is a line, and the database says so rather than trusting every writer to
-- keep it one.
create unique index uq_entry_recognitions_review_event
  on entry_recognitions (tenant_id, review_event_id)
  where review_event_id is not null;
create unique index uq_entry_recognitions_supersedes
  on entry_recognitions (tenant_id, supersedes_id)
  where supersedes_id is not null;

-- a determination is an object of recognised facts, never a list or a
-- bare number that later reads as one
alter table entry_recognitions add constraint chk_entry_recognitions_values_object
  check (jsonb_typeof(values) = 'object');
