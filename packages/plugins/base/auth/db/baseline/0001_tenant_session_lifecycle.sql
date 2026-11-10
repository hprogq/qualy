-- A direct tenant status update and a concurrent session creation must use
-- conflicting row locks, including while an older application is running.
create or replace function qualy_auth_session_tenant_guard()
returns trigger language plpgsql as $$
declare tenant_enabled boolean;
begin
  select enabled into tenant_enabled from tenants where id = new.tenant_id for share;
  if not coalesce(tenant_enabled, false) then
    raise exception 'tenant is not enabled' using errcode = '23514', constraint = 'chk_session_tenant_enabled';
  end if;
  return new;
end;
$$;

create or replace function qualy_auth_tenant_sessions_end()
returns trigger language plpgsql as $$
begin
  delete from sessions where tenant_id = new.id;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'sessions'::regclass and tgname = 'qualy_auth_session_tenant_guard' and not tgisinternal) then
    create trigger qualy_auth_session_tenant_guard before insert on sessions
      for each row execute function qualy_auth_session_tenant_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'tenants'::regclass and tgname = 'qualy_auth_tenant_sessions_end' and not tgisinternal) then
    create trigger qualy_auth_tenant_sessions_end after update of enabled on tenants
      for each row when (old.enabled and not new.enabled)
      execute function qualy_auth_tenant_sessions_end();
  end if;
end;
$$;
