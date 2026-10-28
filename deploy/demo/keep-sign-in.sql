-- The deployment's sign-in configuration, carried onto a restored baseline.
--
-- Runs in the restored database after it has been migrated to the running
-- release, so it has the live database's schema, and after restore.sh has
-- copied the live rows into the qualy_keep_* tables. What carries over is
-- the configuration of each way in and nothing done through it: the
-- entrances themselves (order, names, icons, audience, service settings),
-- their sealed secrets, and the stored images their icons name. Identity
-- bindings, sessions, sign-in records, users added since the baseline and
-- email verification all stay as the baseline has them.
--
-- A secret is sealed to its (tenant, owner kind, owner, key), so it opens
-- only under the entrance id it was written for: entrances keep their ids.
-- Anything that does not fit - an audience naming a user type the baseline
-- lacks, two entrances claiming one code - fails the whole transaction, and
-- restore.sh stops before the site does.

begin;

-- a row for row copy of a staging table onto its table, by id
create function pg_temp.qualy_mirror(target text, source text) returns void
language plpgsql as $$
declare
  names text;
  updates text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position),
         string_agg(format('%1$I = excluded.%1$I', column_name), ', ' order by ordinal_position)
           filter (where column_name <> 'id')
    into names, updates
    from information_schema.columns
   where table_schema = current_schema() and table_name = target;
  execute format(
    'insert into %1$I (%3$s) select %3$s from %2$I on conflict (id) do update set %4$s',
    target, source, names, updates);
end
$$;

-- An entrance the deployment no longer has is retired, not deleted: the
-- baseline's bindings and history may still name it. Recommendation is
-- cleared first because only one entrance per tenant may hold it, and the
-- copy below writes the deployment's choice back.
update auth_providers
   set deleted_at = coalesce(deleted_at, now()), enabled = false
 where id not in (select id from qualy_keep_auth_providers);
update auth_providers set recommended = false where recommended;
do $$ begin perform pg_temp.qualy_mirror('auth_providers', 'qualy_keep_auth_providers'); end $$;

delete from auth_provider_user_types
 where auth_provider_id in (select id from qualy_keep_auth_providers);
insert into auth_provider_user_types select * from qualy_keep_auth_provider_user_types;

delete from secrets where owner_kind = 'auth-provider';
insert into secrets select * from qualy_keep_secrets;

do $$ begin perform pg_temp.qualy_mirror('storage_attachments', 'qualy_keep_storage_attachments'); end $$;

-- every image an entrance draws by came along with it
do $$
begin
  if exists (
    select 1
      from auth_providers p
      cross join lateral jsonb_path_query(p.icon, 'lax $.*.attachmentId') named
      left join storage_attachments a on a.id::text = named #>> '{}'
     where p.deleted_at is null and a.id is null
  ) then
    raise exception 'an entrance icon names an image that was not carried over';
  end if;
end
$$;

drop table qualy_keep_auth_providers, qualy_keep_auth_provider_user_types,
  qualy_keep_secrets, qualy_keep_storage_attachments;

commit;
