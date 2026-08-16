create table "review_supplement_attachments" ("tenant_id" uuid not null, "response_id" uuid not null, "attachment_id" uuid not null, "position" int4 not null, constraint "pk_review_supplement_attachments" primary key ("tenant_id", "response_id", "attachment_id"));

create index "idx_review_supplement_attachments_tenant_attachment" on "review_supplement_attachments" ("tenant_id", "attachment_id");

CREATE UNIQUE INDEX uq_review_supplement_attachments_tenant_response_position ON public.review_supplement_attachments USING btree (tenant_id, response_id, "position");

create table "review_supplement_requests" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "review_instance_id" uuid not null, "request_no" int4 not null, "requested_by" uuid not null, "instructions" text not null, "requirements" jsonb not null, "status" varchar(16) not null default 'open', "answered_at" timestamptz(6) null, "cancelled_at" timestamptz(6) null, "cancelled_by" uuid null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_review_supplement_requests_open" on "review_supplement_requests" ("review_instance_id") where (status)::text = 'open'::text;

create unique index "uq_review_supplement_requests_tenant_id_id" on "review_supplement_requests" ("tenant_id", "id");

create unique index "uq_review_supplement_requests_tenant_instance_no" on "review_supplement_requests" ("tenant_id", "review_instance_id", "request_no");

create table "review_supplement_responses" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "request_id" uuid not null, "payload" jsonb not null, "responded_by" uuid not null, "created_at" timestamptz(6) not null default now(), primary key ("id"));

create unique index "uq_review_supplement_responses_tenant_id_id" on "review_supplement_responses" ("tenant_id", "id");

create unique index "uq_review_supplement_responses_tenant_request" on "review_supplement_responses" ("tenant_id", "request_id");

alter table "review_supplement_attachments" add constraint "fk_review_supplement_attachments_attachment" foreign key ("tenant_id", "attachment_id") references "storage_attachments" ("tenant_id", "id") on update no action on delete restrict;

alter table "review_supplement_attachments" add constraint "fk_review_supplement_attachments_response" foreign key ("tenant_id", "response_id") references "review_supplement_responses" ("tenant_id", "id") on update no action on delete cascade;

alter table "review_supplement_attachments" add constraint "review_supplement_attachments_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "review_supplement_attachments" add constraint "chk_review_supplement_attachments_position_non_negative" check ("position" >= 0);

alter table "review_supplement_requests" add constraint "fk_review_supplement_requests_instance" foreign key ("tenant_id", "review_instance_id") references "review_instances" ("tenant_id", "id") on update no action on delete cascade;

alter table "review_supplement_requests" add constraint "review_supplement_requests_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "review_supplement_requests" add constraint "chk_review_supplement_requests_instructions_not_blank" check (btrim(instructions) <> ''::text);

alter table "review_supplement_requests" add constraint "chk_review_supplement_requests_lifecycle_shape" check (((status = 'open'::text) AND (answered_at IS NULL) AND (cancelled_at IS NULL) AND (cancelled_by IS NULL)) OR ((status = 'answered'::text) AND (answered_at IS NOT NULL) AND (cancelled_at IS NULL) AND (cancelled_by IS NULL)) OR ((status = 'cancelled'::text) AND (cancelled_at IS NOT NULL) AND (cancelled_by IS NOT NULL) AND (answered_at IS NULL)));

alter table "review_supplement_requests" add constraint "chk_review_supplement_requests_no_positive" check (request_no >= 1);

alter table "review_supplement_requests" add constraint "chk_review_supplement_requests_status" check ("status" in ('open', 'answered', 'cancelled'));

alter table "review_supplement_responses" add constraint "fk_review_supplement_responses_request" foreign key ("tenant_id", "request_id") references "review_supplement_requests" ("tenant_id", "id") on update no action on delete cascade;

alter table "review_supplement_responses" add constraint "review_supplement_responses_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

drop index "uq_review_instances_open_entry";

alter table "review_instances" drop constraint "chk_review_instances_state";

alter table "review_instances" alter column "state" type varchar(31) using ("state"::varchar(31));

create unique index "uq_review_instances_open_entry" on "review_instances" ("entry_id") where (state)::text = ANY (ARRAY[('active'::character varying)::text, ('blocked'::character varying)::text, ('awaiting_supplement'::character varying)::text]);

alter table "review_instances" add constraint "chk_review_instances_state" check ("state" in ('active', 'blocked', 'awaiting_supplement', 'completed'));

drop index "uq_review_instances_open_entry";

CREATE UNIQUE INDEX uq_review_instances_open_entry ON public.review_instances USING btree (entry_id) WHERE ((state)::text = ANY (ARRAY[('active'::character varying)::text, ('blocked'::character varying)::text, ('awaiting_supplement'::character varying)::text]));
