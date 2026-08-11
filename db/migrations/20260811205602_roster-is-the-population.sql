-- destructive: approved
-- The scope tables are the definition being removed, not data being lost: who
-- takes part in a batch is batch_participants, which is untouched. What the
-- units were is not carried forward, because the two are not the same claim -
-- a scope said "these people belong here from now on", and an import record
-- says "on this day somebody added people from here".
create table "roster_imports" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "batch_id" uuid not null, "org_node_ids" jsonb not null, "user_type_ids" jsonb not null, "imported_count" int4 not null, "actor_id" uuid null, "occurred_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_roster_imports_batch" on "roster_imports" ("tenant_id", "batch_id", "occurred_at" DESC);

alter table "roster_imports" add constraint "fk_roster_imports_batch" foreign key ("tenant_id", "batch_id") references "assessment_batches" ("tenant_id", "id") on update no action on delete cascade;

alter table "roster_imports" add constraint "roster_imports_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

drop table if exists "batch_scope_nodes" cascade;

drop table if exists "batch_user_types" cascade;

alter table "batch_participants" add "included_by" uuid null, add "excluded_by" uuid null, add "exclusion_reason" varchar(500) null;
