-- One upload, one import. The workbook is bound rather than consumed, and
-- binding an already-bound attachment answers with its metadata by design -
-- right for a general store, wrong as a one-shot - so nothing stopped the
-- same file from being committed twice and writing a second set of official
-- facts. A lost response and a second press are the ordinary way that
-- happens. Re-importing the same spreadsheet on purpose means uploading it
-- again, which is a new attachment.
create unique index "uq_administrative_entry_imports_source" on "administrative_entry_imports" ("tenant_id", "source_attachment_id");
