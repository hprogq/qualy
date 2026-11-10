#!/bin/sh
# Run inside PostgreSQL. Capture the related records in one snapshot before
# importing them into the scratch database.
set -eu
umask 077
snapshot=$(mktemp -d /tmp/qualy-sign-in.XXXXXX)
trap 'rm -f "$snapshot"/auth_providers "$snapshot"/auth_provider_user_types "$snapshot"/secrets "$snapshot"/storage_attachments; rmdir "$snapshot"' EXIT

psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Xq -v ON_ERROR_STOP=1 <<SQL
begin isolation level repeatable read read only;
\o $snapshot/auth_providers
copy auth_providers to stdout;
\o $snapshot/auth_provider_user_types
copy auth_provider_user_types to stdout;
\o $snapshot/secrets
copy (select * from secrets where owner_kind = 'auth-provider') to stdout;
\o $snapshot/storage_attachments
copy (select * from storage_attachments where id::text in (
  select jsonb_path_query(icon, 'lax \$.*.attachmentId') #>> '{}' from auth_providers
)) to stdout;
\o
commit;
SQL

psql -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore" -Xq -v ON_ERROR_STOP=1 <<SQL
begin;
create table qualy_keep_auth_providers (like auth_providers);
create table qualy_keep_auth_provider_user_types (like auth_provider_user_types);
create table qualy_keep_secrets (like secrets);
create table qualy_keep_storage_attachments (like storage_attachments);
\copy qualy_keep_auth_providers from '$snapshot/auth_providers'
\copy qualy_keep_auth_provider_user_types from '$snapshot/auth_provider_user_types'
\copy qualy_keep_secrets from '$snapshot/secrets'
\copy qualy_keep_storage_attachments from '$snapshot/storage_attachments'
commit;
SQL
