create table "batch_management_anchors" ("tenant_id" uuid not null, "batch_id" uuid not null, "org_node_id" uuid not null, "created_at" timestamptz(6) not null default now(), constraint "pk_batch_management_anchors" primary key ("tenant_id", "batch_id", "org_node_id"));

alter table "batch_management_anchors" add constraint "batch_management_anchors_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "batch_management_anchors" add constraint "fk_batch_management_anchors_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "batch_management_anchors" add constraint "fk_batch_management_anchors_node" foreign key ("tenant_id", "org_node_id") references "org_nodes" ("tenant_id", "id") on update no action on delete restrict;

-- Rounds that existed before the boundary did.
--
-- The units a round was drawn from are recorded in roster_imports (the query
-- somebody ran, as they wrote it), and a batch created before this migration
-- has one from its creation. Nodes deleted since are skipped: the boundary is
-- checked against live nodes, and a reference to a unit that no longer exists
-- would refuse the round to everybody.
insert into batch_management_anchors (tenant_id, batch_id, org_node_id)
select distinct ri.tenant_id, ri.batch_id, node.id::uuid
from roster_imports ri
cross join lateral jsonb_array_elements_text(ri.org_node_ids) as node(id)
join org_nodes n on n.tenant_id = ri.tenant_id and n.id = node.id::uuid
on conflict do nothing;
