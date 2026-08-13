-- the allowance table predates assessment_items, so rows written before the
-- key existed may name ids no item ever had; they could never gate anything
-- and there is nothing to keep
delete from phase_item_scopes pis
where not exists (
  select 1 from assessment_items ai
  where ai.tenant_id = pis.tenant_id and ai.id = pis.item_id
);

alter table "phase_item_scopes" add constraint "fk_phase_item_scopes_item" foreign key ("tenant_id", "item_id") references "assessment_items" ("tenant_id", "id") on update no action on delete cascade;
