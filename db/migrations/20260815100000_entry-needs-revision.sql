create table "entry_events" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "entry_id" uuid not null, "kind" varchar(31) not null, "actor_id" uuid null, "reason" varchar(500) null, "cause_revision_id" uuid null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_entry_events_tenant_entry_created" on "entry_events" ("tenant_id", "entry_id", "created_at");

alter table "entry_events" add constraint "entry_events_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "entry_events" add constraint "fk_entry_events_cause_revision" foreign key ("tenant_id", "cause_revision_id") references "assessment_item_revisions" ("tenant_id", "id") on update no action on delete set null (cause_revision_id);

alter table "entry_events" add constraint "fk_entry_events_entry" foreign key ("tenant_id", "entry_id") references "entries" ("tenant_id", "id") on update no action on delete cascade;

alter table "entry_events" add constraint "chk_entry_events_kind_format" check (kind ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);

alter table "entries" drop constraint "chk_entries_status";

alter table "entries" add constraint "chk_entries_status" check ("status" in ('draft', 'in_review', 'needs_revision', 'approved', 'rejected', 'voided'));
