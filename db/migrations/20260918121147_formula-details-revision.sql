-- A formula's name and description get a concurrency token of their own.
-- Renaming moves no draft revision - nothing that could be published
-- changed - so two windows that each read the same draft revision were both
-- accepted against it, and the later save dropped the earlier one's words
-- with neither author seeing anything. Existing rows start at 1.
alter table "assessment_formula_functions" add "details_revision" int4 not null default 1;
