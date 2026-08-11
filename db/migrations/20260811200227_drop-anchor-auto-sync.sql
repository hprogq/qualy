-- destructive: approved
-- Nothing ever read it. The roster deliberately never moves on its own - an
-- organizational change is listed as a suggestion and applied by hand - so a
-- switch promising the opposite was configuration nobody could act on.
alter table "assessment_batches" drop column "anchor_auto_sync";
