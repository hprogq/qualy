-- The references an administrative import holds, held by the database: its
-- question belongs to its round, its frozen version belongs to its question,
-- its workbook exists and stays, and each row names the person its entry is
-- about. The unique index comes first because the row key references it; the
-- generator emitted it last.

create unique index "uq_entries_tenant_id_participant" on "entries" ("tenant_id", "id", "participant_id");

alter table "administrative_entry_import_rows" drop constraint "fk_administrative_entry_import_rows_entry";

alter table "administrative_entry_imports" drop constraint "fk_administrative_entry_imports_item";

alter table "administrative_entry_import_rows" add constraint "fk_administrative_entry_import_rows_entry" foreign key ("tenant_id", "entry_id", "participant_id") references "entries" ("tenant_id", "id", "participant_id") on update no action on delete cascade;

alter table "administrative_entry_imports" alter column "source_attachment_id" set not null;

alter table "administrative_entry_imports" add constraint "fk_administrative_entry_imports_item_revision" foreign key ("tenant_id", "item_id", "item_revision_id") references "assessment_item_revisions" ("tenant_id", "item_id", "id") on update no action on delete restrict;

alter table "administrative_entry_imports" add constraint "fk_administrative_entry_imports_source_attachment" foreign key ("tenant_id", "source_attachment_id") references "storage_attachments" ("tenant_id", "id") on update no action on delete restrict;

alter table "administrative_entry_imports" add constraint "fk_administrative_entry_imports_item" foreign key ("tenant_id", "batch_id", "item_id") references "assessment_items" ("tenant_id", "batch_id", "id") on update no action on delete cascade;
