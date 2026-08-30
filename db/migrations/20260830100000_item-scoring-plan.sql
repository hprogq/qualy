-- owner: @qualy/plugin-assessment

-- The compiled arithmetic of an item revision, beside the configuration an
-- administrator wrote.
--
-- scoring_config stays the authored intent; scoring_plan is what a scoring
-- run executes: every calculator parameter bound exactly once, every binding
-- proven assignable against the calculator's own contract, every conversion
-- recorded by name. Compiling it once, at save, is what keeps a score from
-- re-deriving type decisions in front of a student.
--
-- Nullable on purpose, and only for now. Existing revisions are compiled by
-- the assembly's own boot backfill, which runs the one compiler that new
-- revisions use - a SQL translation of canonicalisation and hashing would be
-- a second implementation of the identity this column exists to freeze. The
-- NOT NULL follows in its own migration once every deployment has booted
-- through that backfill.

alter table assessment_item_revisions add column scoring_plan jsonb;
