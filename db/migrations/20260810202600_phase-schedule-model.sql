-- destructive: approved
-- the phase model keeps only what a phase is for: which state a batch is in,
-- what it allows, and when the next one begins. the trigger, the working-day
-- offset, the estimate and the publication binding drove nothing that survived
-- review, and the columns go with them.

drop index "uq_batch_phases_opens_publication";

alter table "batch_phases" drop constraint "chk_batch_phases_entry_trigger";

alter table "batch_phases" drop constraint "chk_batch_phases_publication_binding";

alter table "batch_phases" drop column "entry_trigger", drop column "entry_offset", drop column "estimated_entry_at", drop column "opens_publication_id";

alter table "batch_phases" add "description" varchar(500) not null default '';
