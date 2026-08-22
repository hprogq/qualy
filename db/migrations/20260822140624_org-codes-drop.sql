-- destructive: approved
-- The organization speaks names: the code columns carried nothing the
-- product reads, and naming a thing twice only cost the person creating it.
drop index "uq_org_nodes_tenant_code";

alter table "org_nodes" drop constraint "chk_org_nodes_code_format";

alter table "org_nodes" drop column "code";

drop index "uq_org_types_tenant_code";

alter table "org_types" drop constraint "chk_org_types_code_format";

alter table "org_types" drop column "code";
