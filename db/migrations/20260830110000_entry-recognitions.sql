-- owner: @qualy/plugin-assessment

-- What the institution decided, as its own fact.
--
-- Until now an approved entry said only that: approved. What it was approved
-- AS lived nowhere, because every calculator answered from the student's own
-- payload. That is the arrangement this table ends. Evidence stays exactly
-- as the student wrote it; recognition is what review made of it, appended
-- and never edited, so a downgrade is explainable as two facts in order
-- rather than as a value that quietly changed.
--
-- Everything here is keyed by recognition id, never by a calculator's
-- parameter name: parameter names belong to one version of one function and
-- these determinations outlive both.

create table entry_recognitions (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  batch_id uuid not null,
  entry_id uuid not null,
  entry_revision_id uuid not null,
  item_id uuid not null,
  item_revision_id uuid not null,
  values jsonb not null,
  source varchar(16) not null,
  review_instance_id uuid null,
  review_event_id uuid null,
  supersedes_id uuid null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint chk_entry_recognitions_source
    check (source in ('review', 'record', 'import', 'system')),
  -- a determination made by review names the round and the word that made
  -- it; one made any other way names neither, rather than half a story
  constraint chk_entry_recognitions_review_shape check (
    (source <> 'review' and review_instance_id is null and review_event_id is null)
    or (source = 'review' and review_instance_id is not null and review_event_id is not null)
  )
);

alter table entry_recognitions
  add constraint entry_recognitions_tenant_id_tenants_id_fkey
  foreign key (tenant_id) references tenants (id) on delete cascade;

create unique index uq_entry_recognitions_tenant_id_id
  on entry_recognitions (tenant_id, id);
create unique index uq_entry_recognitions_tenant_entry_id
  on entry_recognitions (tenant_id, entry_id, id);
create index idx_entry_recognitions_tenant_entry_created
  on entry_recognitions (tenant_id, entry_id, created_at);

-- the keys a composite reference needs on the other side
create unique index uq_entries_tenant_batch_id on entries (tenant_id, batch_id, id);
create unique index uq_review_events_tenant_instance_id
  on review_events (tenant_id, review_instance_id, id);

alter table entry_recognitions add constraint fk_entry_recognitions_entry
  foreign key (tenant_id, batch_id, entry_id) references entries (tenant_id, batch_id, id) on delete cascade;
alter table entry_recognitions add constraint fk_entry_recognitions_entry_revision
  foreign key (tenant_id, entry_id, entry_revision_id) references entry_revisions (tenant_id, entry_id, id) on delete cascade;
alter table entry_recognitions add constraint fk_entry_recognitions_entry_item
  foreign key (tenant_id, entry_id, item_id) references entries (tenant_id, id, item_id) on delete cascade;
alter table entry_recognitions add constraint fk_entry_recognitions_item_revision
  foreign key (tenant_id, item_id, item_revision_id) references assessment_item_revisions (tenant_id, item_id, id) on delete restrict;
alter table entry_recognitions add constraint fk_entry_recognitions_supersedes
  foreign key (tenant_id, entry_id, supersedes_id) references entry_recognitions (tenant_id, entry_id, id) on delete set null (supersedes_id);
alter table entry_recognitions add constraint fk_entry_recognitions_review_instance
  foreign key (tenant_id, entry_id, review_instance_id) references review_instances (tenant_id, entry_id, id) on delete set null (review_instance_id);
alter table entry_recognitions add constraint fk_entry_recognitions_review_event
  foreign key (tenant_id, review_instance_id, review_event_id) references review_events (tenant_id, review_instance_id, id) on delete set null (review_event_id);

-- Which recognition contract a round determines under.
--
-- The same item revision the policy is read from today, and a separate
-- column anyway: what a round asks a reviewer to determine and what
-- procedure it walks are two facts, and they will not always move together.
alter table review_instances add column recognition_revision_id uuid;
update review_instances set recognition_revision_id = policy_revision_id;
alter table review_instances alter column recognition_revision_id set not null;
alter table review_instances
  add constraint fk_review_instances_recognition_revision
  foreign key (tenant_id, recognition_revision_id)
  references assessment_item_revisions (tenant_id, id) on delete restrict;

-- What a decision determined, on the decision itself.
alter table review_events add column recognition_payload jsonb null;
alter table review_events add column recognition_reason text null;
alter table review_events add column recognition_hash varchar(64) null;

-- The one determination a sitting votes on, frozen by its first ballot.
alter table review_panels add column recognition_payload jsonb null;
alter table review_panels add column recognition_hash varchar(64) null;
alter table review_panels add column recognition_locked_at timestamptz null;
alter table review_votes add column recognition_hash varchar(64) null;

-- The pointer, and the determinations every already-approved entry needs.
alter table entries add column current_recognition_id uuid null;

-- Every approved entry gets the determination it always implicitly had: the
-- empty one. Today's only calculator asks for no recognised facts at all, so
-- "{}" is not a placeholder here - it is the complete and correct answer.
--
-- What is NOT invented is provenance. A claim that went through review names
-- the round that approved it and the word that did; an administrative record
-- names the configuration it was filed under, which is the same instant it
-- was approved; an entry approved automatically names the configuration that
-- was current WHEN the automatic approval happened, recovered from the event
-- that recorded it - not the configuration its filing was written under,
-- which may be older and is not what the decision was made against.
insert into entry_recognitions (
  tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
  values, source, review_instance_id, review_event_id, created_by, created_at
)
select
  e.tenant_id,
  e.batch_id,
  e.id,
  e.current_revision_id,
  e.item_id,
  case
    when decided.instance_id is not null then decided.recognition_revision_id
    when auto.event_at is not null then auto.item_revision_id
    else er.item_revision_id
  end,
  '{}'::jsonb,
  case
    when decided.instance_id is not null then 'review'
    when e.source = 'record' then 'record'
    when e.source = 'import' then 'import'
    else 'system'
  end,
  decided.instance_id,
  decided.event_id,
  case when decided.instance_id is not null then decided.actor_id else er.actor_id end,
  coalesce(decided.decided_at, auto.event_at, er.created_at)
from entries e
join entry_revisions er
  on er.tenant_id = e.tenant_id and er.id = e.current_revision_id
left join lateral (
  -- the round that approved it, and the word that did
  select ri.id as instance_id,
         ri.recognition_revision_id,
         ev.id as event_id,
         ev.actor_id,
         ev.created_at as decided_at
  from review_instances ri
  join review_events ev
    on ev.tenant_id = ri.tenant_id and ev.review_instance_id = ri.id and ev.kind = 'approved'
  where ri.tenant_id = e.tenant_id
    and ri.entry_id = e.id
    and ri.state = 'completed'
    and ri.outcome = 'approved'
  order by ev.created_at desc
  limit 1
) decided on true
left join lateral (
  -- approved with no reviewer at all: the configuration in force at that
  -- moment is the newest revision of the question created by then, because
  -- a question's current revision only ever moves forward as one is
  -- appended. If that cannot be recovered the insert fails on a not-null
  -- column, which is the correct outcome: a determination with invented
  -- provenance is worse than a migration that stops and says so
  select ee.created_at as event_at,
         (
           select r.id
           from assessment_item_revisions r
           where r.tenant_id = e.tenant_id
             and r.item_id = e.item_id
             and r.created_at <= ee.created_at
           order by r.revision_no desc
           limit 1
         ) as item_revision_id
  from entry_events ee
  where ee.tenant_id = e.tenant_id
    and ee.entry_id = e.id
    and ee.kind = 'auto-approved'
  order by ee.created_at desc
  limit 1
) auto on true
where e.status = 'approved'
  and e.current_revision_id is not null;

update entries e
set current_recognition_id = r.id
from entry_recognitions r
where r.tenant_id = e.tenant_id
  and r.entry_id = e.id
  and e.status = 'approved';

-- The pointer is held to this entry's own determinations: a composite key,
-- so no entry can name another's recognition even inside one tenant.
alter table entries add constraint fk_entries_current_recognition
  foreign key (tenant_id, id, current_recognition_id)
  references entry_recognitions (tenant_id, entry_id, id)
  on delete set null (current_recognition_id);

-- An approved claim has been recognised as something. The reverse is
-- deliberately not stated: a reopened or overturned entry keeps its last
-- determination as history, and the scorer ignores it by status.
alter table entries add constraint chk_entries_approved_has_recognition
  check (status <> 'approved' or current_recognition_id is not null);
