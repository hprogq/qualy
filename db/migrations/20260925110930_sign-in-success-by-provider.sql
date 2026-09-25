create index "idx_sign_in_events_provider_success" on "sign_in_events" ("tenant_id", "provider_id") where (outcome)::text = 'success'::text;
