-- rollout: maintenance
-- A claim's last handed-in version, which everybody but its owner reads: a
-- draft never sent is its owner's alone, and a claim being revised after a
-- return goes on showing what was handed in until the revision is sent.
--
-- Maintenance, not expand: the check below refuses a claim under review
-- without it, and the release before this one submits without writing it.

alter table "entries" add "last_submitted_revision_id" uuid null;

-- Under review, decided or sent back: the version the claim stands on is the
-- one handed in, because writing a new version moves a claim back to draft.
-- An administrative fact is handed in by being written, withdrawn or not.
update entries
   set last_submitted_revision_id = current_revision_id
 where current_revision_id is not null
   and (status in ('in_review', 'approved', 'rejected', 'needs_revision')
        or source in ('record', 'import'));

-- A draft or a claim given up was handed in if anything was ever done with
-- one of its versions - a round opened on it, a determination made on it -
-- and the last such version is the one handed in. Read from that history,
-- not from the latest version, which for a claim taken back or being revised
-- is still on its owner's desk.
update entries e
   set last_submitted_revision_id = handed.id
  from (
    select distinct on (r.tenant_id, r.entry_id) r.tenant_id, r.entry_id, r.id
      from entry_revisions r
     where exists (
             select 1
               from review_instances ri
              where ri.tenant_id = r.tenant_id
                and ri.entry_id = r.entry_id
                and ri.revision_id = r.id
           )
        or exists (
             select 1
               from entry_recognitions c
              where c.tenant_id = r.tenant_id
                and c.entry_id = r.entry_id
                and c.entry_revision_id = r.id
           )
     order by r.tenant_id, r.entry_id, r.revision_no desc
  ) handed
 where e.tenant_id = handed.tenant_id
   and e.id = handed.entry_id
   and e.last_submitted_revision_id is null;

alter table "entries" add constraint "fk_entries_last_submitted_revision" foreign key ("tenant_id", "id", "last_submitted_revision_id") references "entry_revisions" ("tenant_id", "entry_id", "id") on update no action on delete restrict;

alter table "entries" add constraint "chk_entries_handed_in" check ((status = ANY (ARRAY['draft'::character varying, 'voided'::character varying])) OR (last_submitted_revision_id IS NOT NULL));
