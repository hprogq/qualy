-- destructive: approved
-- The batch scope becomes a node set: batch_scope_nodes replaces the two
-- scope columns on assessment_batches, and every existing batch's single
-- scope node is carried over before the columns go.

create table "batch_scope_nodes" ("tenant_id" uuid not null, "batch_id" uuid not null, "node_id" uuid not null, "created_at" timestamptz(6) not null default now(), constraint "pk_batch_scope_nodes" primary key ("tenant_id", "batch_id", "node_id"));

create index "idx_batch_scope_nodes_tenant_node" on "batch_scope_nodes" ("tenant_id", "node_id");

alter table "batch_scope_nodes" add constraint "batch_scope_nodes_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "batch_scope_nodes" add constraint "fk_batch_scope_nodes_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

insert into "batch_scope_nodes" ("tenant_id", "batch_id", "node_id") select "tenant_id", "id", "scope_node_id" from "assessment_batches";

alter table "assessment_batches" drop constraint "fk_assessment_batches_scope_node";

drop index "idx_assessment_batches_tenant_scope_node";

alter table "assessment_batches" drop column "scope_node_id", drop column "scope_path";
