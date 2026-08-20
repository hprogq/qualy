create table "review_panel_assignments" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "panel_id" uuid not null, "seat_no" int4 not null, "user_id" uuid not null, "assigned_at" timestamptz(6) not null default now(), "ended_at" timestamptz(6) null, "ended_reason" varchar(31) null, primary key ("id"));

create index "idx_review_panel_assignments_tenant_panel" on "review_panel_assignments" ("tenant_id", "panel_id");

create unique index "uq_review_panel_assignments_live_seat" on "review_panel_assignments" ("panel_id", "seat_no") where ended_at IS NULL;

create unique index "uq_review_panel_assignments_live_user" on "review_panel_assignments" ("panel_id", "user_id") where ended_at IS NULL;

create unique index "uq_review_panel_assignments_tenant_id_id" on "review_panel_assignments" ("tenant_id", "id");

create table "review_panels" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "review_instance_id" uuid not null, "route" varchar(16) not null, "stage_id" varchar(63) not null, "seat_count" int4 not null, "state" varchar(16) not null default 'open', "resolution" varchar(16) null, "created_at" timestamptz(6) not null default now(), "closed_at" timestamptz(6) null, primary key ("id"));

create index "idx_review_panels_tenant_instance" on "review_panels" ("tenant_id", "review_instance_id");

create unique index "uq_review_panels_open_instance" on "review_panels" ("review_instance_id") where (state)::text = 'open'::text;

create unique index "uq_review_panels_tenant_id_id" on "review_panels" ("tenant_id", "id");

create table "review_votes" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "panel_id" uuid not null, "assignment_id" uuid not null, "voter_user_id" uuid not null, "decision" varchar(16) not null, "reason" varchar(100) null, "comment" text null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_review_votes_tenant_panel" on "review_votes" ("tenant_id", "panel_id");

create unique index "uq_review_votes_assignment" on "review_votes" ("assignment_id");

alter table "review_panel_assignments" add constraint "fk_review_panel_assignments_panel" foreign key ("tenant_id", "panel_id") references "review_panels" ("tenant_id", "id") on update no action on delete cascade;

alter table "review_panel_assignments" add constraint "review_panel_assignments_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "review_panel_assignments" add constraint "chk_review_panel_assignments_ended_shape" check (((ended_at IS NULL) AND (ended_reason IS NULL)) OR ((ended_at IS NOT NULL) AND (ended_reason IS NOT NULL)));

alter table "review_panel_assignments" add constraint "chk_review_panel_assignments_seat_positive" check (seat_no >= 1);

alter table "review_panels" add constraint "fk_review_panels_instance" foreign key ("tenant_id", "review_instance_id") references "review_instances" ("tenant_id", "id") on update no action on delete cascade;

alter table "review_panels" add constraint "review_panels_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "review_panels" add constraint "chk_review_panels_lifecycle_shape" check (((state = 'open'::text) AND (resolution IS NULL) AND (closed_at IS NULL)) OR ((state = 'resolved'::text) AND (resolution IS NOT NULL) AND (closed_at IS NOT NULL)) OR ((state = 'superseded'::text) AND (resolution IS NULL) AND (closed_at IS NOT NULL)));

alter table "review_panels" add constraint "chk_review_panels_seat_count_positive" check (seat_count >= 1);

alter table "review_panels" add constraint "chk_review_panels_state" check ("state" in ('open', 'resolved', 'superseded'));

alter table "review_votes" add constraint "fk_review_votes_assignment" foreign key ("tenant_id", "assignment_id") references "review_panel_assignments" ("tenant_id", "id") on update no action on delete cascade;

alter table "review_votes" add constraint "fk_review_votes_panel" foreign key ("tenant_id", "panel_id") references "review_panels" ("tenant_id", "id") on update no action on delete cascade;

alter table "review_votes" add constraint "review_votes_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "review_votes" add constraint "chk_review_votes_decision" check ("decision" in ('approve', 'reject'));

alter table "review_instances" add "blocked_reason" varchar(31) null;

-- rounds blocked before the reason column existed were all staffing gaps:
-- the old patrol wrote blocked for exactly one cause
update "review_instances" set "blocked_reason" = 'no-assignee' where "state" = 'blocked' and "blocked_reason" is null;

alter table "review_instances" add constraint "chk_review_instances_blocked_reason_shape" check (((state <> 'blocked'::text) AND (blocked_reason IS NULL)) OR ((state = 'blocked'::text) AND (blocked_reason IS NOT NULL)));
