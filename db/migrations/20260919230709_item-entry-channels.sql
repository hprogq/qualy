-- destructive: approved
-- A question is filed through one or more doors rather than exactly one:
-- participants filing for themselves, staff recording an administrative
-- fact, or both. The single-valued entry_source becomes a list; every
-- revision written so far named one door, and a derived question (nobody
-- files it) had 'administrative' written on it by the editor as a placeholder
-- and now says nobody does.
alter table "assessment_item_revisions" add "entry_channels" jsonb not null default '[]'::jsonb;

update "assessment_item_revisions" r
set "entry_channels" = case
  when i."item_type" = 'constant' then '[]'::jsonb
  when r."entry_source" = 'student' then '["participant"]'::jsonb
  else '["administrative"]'::jsonb
end
from "assessment_items" i
where i."tenant_id" = r."tenant_id" and i."id" = r."item_id";

alter table "assessment_item_revisions" alter column "entry_channels" drop default;

alter table "assessment_item_revisions" drop constraint "chk_assessment_item_revisions_entry_source";

alter table "assessment_item_revisions" drop column "entry_source";
