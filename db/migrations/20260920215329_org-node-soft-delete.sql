-- owner: @qualy/plugin-org
-- A unit taken out of the structure keeps its row: closed rounds and withdrawn
-- grants still name it, and it can be put back. Its name is free for a sibling
-- while it is away, so the sibling-name index counts standing units only.
alter table "org_nodes" add "deleted_at" timestamptz(6) null;

drop index "uq_org_nodes_tenant_parent_name";

create unique index "uq_org_nodes_tenant_parent_name" on "org_nodes" ("tenant_id", "parent_id", "name") where (parent_id IS NOT NULL) AND (deleted_at IS NULL);
