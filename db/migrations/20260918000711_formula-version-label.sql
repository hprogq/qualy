-- A published version's name and notes become a label rather than part of
-- the frozen record: they may be rewritten afterwards, while everything the
-- version executes stays exactly as it was proven. The revision is their own
-- concurrency token, and the two timestamps stay null until somebody first
-- rewrites them - existing rows still read as their publisher wrote them.
alter table "assessment_formula_versions" add "metadata_revision" int4 not null default 1, add "metadata_updated_at" timestamptz(6) null, add "metadata_updated_by" uuid null;
