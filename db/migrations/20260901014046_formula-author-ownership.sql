-- owner: @qualy/plugin-assessment-formula
-- destructive: approved
--
-- A formula's owning node carried three unrelated jobs at once: who could
-- edit it, who could see it, and which rounds one of its versions could be
-- newly bound to. Those are now three different answers - the author, a
-- share scope that does not exist yet, and the author again - and none of
-- them is a node on the org tree, so the column goes.
--
-- Nothing is carried over. The old value was a MANAGEMENT range; the thing
-- that will one day replace it for visibility is a sharing decision, and
-- turning one into the other would be making that decision on the author's
-- behalf. What survives is `created_by`, which was always written and now
-- means what it says: every existing formula becomes its author's own.
--
-- The index moves rather than disappearing: the library list is a keyset
-- over one author's formulas, newest touched first.

drop index "idx_assessment_formula_functions_tenant_owner";

alter table "assessment_formula_functions" drop column "owner_node_id";

create index "idx_assessment_formula_functions_tenant_author_updated" on "assessment_formula_functions" ("tenant_id", "created_by", "updated_at", "id");

-- `assessment.formula.manage` retires with the model it belonged to. It was
-- org-node scoped and meant "administer the formulas of this unit"; the
-- capability that replaces it is tenant-wide and means "may write formulas
-- of your own", so an automatic mapping would be handing somebody authority
-- nobody granted them. A database upgraded from an earlier release still
-- carries the old code in `permissions` and in whatever roles had it
-- ticked, and a stale row reads as a promise - so it is removed everywhere
-- it can be, including the two assessment tables that copy a permission code
-- as text and therefore do not cascade.
delete from batch_access_source_permissions where permission_code = 'assessment.formula.manage';
delete from batch_access_denies where permission_code = 'assessment.formula.manage';
delete from role_permissions rp using permissions p
 where p.id = rp.permission_id and p.code = 'assessment.formula.manage';
delete from permissions where code = 'assessment.formula.manage';
