create table "storage_attachments" ("id" uuid not null, "tenant_id" uuid not null, "owner_user_id" uuid not null, "backend" varchar(31) not null, "filename" varchar(255) not null, "declared_mime" varchar(127) not null, "size" int8 not null, "integrity_algorithm" varchar(31) not null, "integrity_value" varchar(127) not null, "etag" varchar(127) null, "storage_key" varchar(255) not null, "status" varchar(31) not null default 'staged', "bound_at" timestamptz(6) null, "created_at" timestamptz(6) not null default now(), "cleanup_claimed_at" timestamptz(6) null, primary key ("id"));

create index "idx_storage_attachments_owner" on "storage_attachments" ("tenant_id", "owner_user_id", "status");

create index "idx_storage_attachments_sweep" on "storage_attachments" ("status", "created_at");

create unique index "uq_storage_attachments_object" on "storage_attachments" ("backend", "storage_key");

create unique index "uq_storage_attachments_tenant_id_id" on "storage_attachments" ("tenant_id", "id");

create table "storage_upload_reservations" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "owner_user_id" uuid not null, "attachment_id" uuid not null, "backend" varchar(31) not null, "storage_key" varchar(255) not null, "filename" varchar(255) not null, "declared_mime" varchar(127) not null, "reserved_bytes" int8 not null, "status" varchar(31) not null default 'issued', "grant_expires_at" timestamptz(6) not null, "cleanup_after" timestamptz(6) not null, "created_at" timestamptz(6) not null default now(), "completed_at" timestamptz(6) null, "expired_at" timestamptz(6) null, "failed_at" timestamptz(6) null, "cleanup_claimed_at" timestamptz(6) null, primary key ("id"));

create index "idx_storage_upload_reservations_owner" on "storage_upload_reservations" ("tenant_id", "owner_user_id", "created_at" DESC);

create index "idx_storage_upload_reservations_sweep" on "storage_upload_reservations" ("status", "cleanup_after");

create unique index "uq_storage_upload_reservations_attachment" on "storage_upload_reservations" ("attachment_id");

create unique index "uq_storage_upload_reservations_object" on "storage_upload_reservations" ("backend", "storage_key");

alter table "storage_attachments" add constraint "chk_storage_attachments_bound_at" check ((status = 'staged'::text) = (bound_at IS NULL));

alter table "storage_attachments" add constraint "chk_storage_attachments_size" check (size >= 0);

alter table "storage_attachments" add constraint "chk_storage_attachments_status" check ("status" in ('staged', 'bound', 'retired'));

alter table "storage_upload_reservations" add constraint "chk_storage_upload_reservations_cleanup_after" check (cleanup_after >= grant_expires_at);

alter table "storage_upload_reservations" add constraint "chk_storage_upload_reservations_reserved_bytes" check (reserved_bytes > 0);

alter table "storage_upload_reservations" add constraint "chk_storage_upload_reservations_status" check ("status" in ('issued', 'completed', 'expired', 'failed'));
