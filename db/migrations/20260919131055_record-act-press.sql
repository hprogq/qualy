alter table "administrative_record_operations" add "idempotency_key" uuid null;

create unique index "uq_administrative_record_operations_press" on "administrative_record_operations" ("tenant_id", "batch_id", "idempotency_key") where idempotency_key IS NOT NULL;
