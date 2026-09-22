-- owner: @qualy/plugin-auth
-- destructive: approved
-- What binds a person to a door, renamed for what it is. A door either finds
-- people by a fact of their own (the password door by their email, a campus
-- door by their business number) and keeps at most a credential here, or its
-- accounts live elsewhere and the external account's durable id is kept as
-- the subject. The password door's sign-in names are dropped: it signs in by
-- the person's email from now on, and the credential it kept stays.
alter table "user_identities" rename to "user_auth_bindings";

alter table "user_auth_bindings" rename constraint "user_identities_pkey" to "user_auth_bindings_pkey";

alter table "user_auth_bindings" rename constraint "user_identities_tenant_id_tenants_id_fkey" to "user_auth_bindings_tenant_id_tenants_id_fkey";

alter table "user_auth_bindings" rename constraint "fk_user_identities_user" to "fk_user_auth_bindings_user";

alter table "user_auth_bindings" rename constraint "fk_user_identities_provider" to "fk_user_auth_bindings_provider";

alter table "user_auth_bindings" rename constraint "user_identities_id_not_null" to "user_auth_bindings_id_not_null";

alter table "user_auth_bindings" rename constraint "user_identities_tenant_id_not_null" to "user_auth_bindings_tenant_id_not_null";

alter table "user_auth_bindings" rename constraint "user_identities_user_id_not_null" to "user_auth_bindings_user_id_not_null";

alter table "user_auth_bindings" rename constraint "user_identities_auth_provider_id_not_null" to "user_auth_bindings_auth_provider_id_not_null";

alter table "user_auth_bindings" rename constraint "user_identities_bound_at_not_null" to "user_auth_bindings_bound_at_not_null";

alter index "uq_user_identities_tenant_id_id" rename to "uq_user_auth_bindings_tenant_id_id";

alter index "uq_user_identities_user_provider" rename to "uq_user_auth_bindings_user_provider";

drop index "uq_user_identities_login";

alter table "user_auth_bindings" rename column "identifier" to "subject";

alter table "user_auth_bindings" alter column "subject" drop not null;

alter table "user_auth_bindings" add "display_label" varchar(255) null;

update "user_auth_bindings" b set "subject" = null
  from "auth_providers" p
 where p.id = b.auth_provider_id and p.type = 'local';

create unique index "uq_user_auth_bindings_subject" on "user_auth_bindings" ("tenant_id", "auth_provider_id", "subject") where (revoked_at IS NULL) AND (subject IS NOT NULL);

alter table "sign_in_events" rename column "identity_id" to "binding_id";

-- A session remembers the door it came in through, and the binding when the
-- door keeps one. Every session so far was opened by a sign-in the record
-- names; one the record cannot account for is ended rather than guessed at.
alter table "sessions" add "auth_provider_id" uuid null, add "auth_binding_id" uuid null;

update "sessions" s
   set "auth_provider_id" = e.provider_id, "auth_binding_id" = e.binding_id
  from "sign_in_events" e
 where e.tenant_id = s.tenant_id and e.session_id = s.id and e.outcome = 'success';

delete from "sessions" where "auth_provider_id" is null;

alter table "sessions" alter column "auth_provider_id" set not null;

create index "idx_sessions_tenant_provider" on "sessions" ("tenant_id", "auth_provider_id");

alter table "sessions" add constraint "fk_sessions_provider" foreign key ("tenant_id", "auth_provider_id") references "auth_providers" ("tenant_id", "id") on update no action on delete restrict;

alter table "sessions" add constraint "fk_sessions_binding" foreign key ("tenant_id", "auth_binding_id") references "user_auth_bindings" ("tenant_id", "id") on update no action on delete set null (auth_binding_id);

-- A door taken out of service for good keeps its row, because events and
-- bindings name it; its address is free for a new door.
alter table "auth_providers" add "deleted_at" timestamptz(6) null;

alter table "auth_providers" add constraint "chk_auth_providers_deleted_is_disabled" check ((deleted_at IS NULL) OR (enabled = false));

drop index "uq_auth_providers_tenant_code";

create unique index "uq_auth_providers_tenant_code" on "auth_providers" ("tenant_id", "code") where (deleted_at IS NULL);

-- One password door per tenant, provisioned by the platform. A tenant that
-- ended up with several keeps one (the one at the address `local`, else the
-- one already marked as the platform's, else the oldest). A second door
-- nobody uses is retired. A second door somebody DOES use is not merged: its
-- audience and its credentials cannot be folded into another door without
-- widening or narrowing who may come in, so the migration stops and names it,
-- and a person decides.
do $$
declare
  tenant record;
  canonical uuid;
  extra record;
begin
  for tenant in select id, slug from tenants loop
    select id into canonical
      from auth_providers
     where tenant_id = tenant.id and type = 'local'
     order by (code = 'local') desc, is_system desc, created_at, id
     limit 1;
    if canonical is null then
      insert into auth_providers (tenant_id, code, type, name, is_system, enabled, sort_order)
      values (
        tenant.id, 'local', 'local', '本地账号', true, true,
        coalesce((select max(sort_order) + 1 from auth_providers where tenant_id = tenant.id), 0)::smallint
      );
      continue;
    end if;
    update auth_providers set is_system = false
     where tenant_id = tenant.id and type = 'local' and id <> canonical;
    update auth_providers set is_system = true where id = canonical;
    for extra in
      select id, code from auth_providers
       where tenant_id = tenant.id and type = 'local' and id <> canonical and deleted_at is null
    loop
      if exists (
           select 1 from user_auth_bindings
            where auth_provider_id = extra.id and revoked_at is null
         ) or exists (select 1 from sessions where auth_provider_id = extra.id) then
        raise exception
          'tenant % has a second password door % that is in use; withdraw its accounts or move them to the tenant''s password door, then migrate again',
          tenant.slug, extra.code;
      end if;
      update auth_providers set enabled = false, deleted_at = now() where id = extra.id;
    end loop;
  end loop;
end $$;

create unique index "uq_auth_providers_tenant_system_type" on "auth_providers" ("tenant_id", "type") where is_system AND (deleted_at IS NULL);
