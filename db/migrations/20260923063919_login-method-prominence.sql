-- Sign-in doors are presented in two groups: primary (listed in full, at most three
-- per tenant) and secondary (tiles). Every door used to be listed in full, so the
-- first three live doors of each tenant, in the order they were shown, stay primary.

alter table "auth_providers" add "prominence" varchar(16) not null default 'secondary', add "recommended" bool not null default false, add "icon" jsonb null;

create unique index "uq_auth_providers_tenant_recommended" on "auth_providers" ("tenant_id") where recommended AND (deleted_at IS NULL);

alter table "auth_providers" add constraint "chk_auth_providers_prominence" check ((prominence = 'primary'::text) OR (prominence = 'secondary'::text));

alter table "auth_providers" add constraint "chk_auth_providers_recommended_is_primary" check ((recommended = false) OR (prominence = 'primary'::text));

update auth_providers p
   set prominence = 'primary'
  from (
    select id,
           row_number() over (partition by tenant_id order by sort_order, code) as place
      from auth_providers
     where deleted_at is null
  ) ranked
 where ranked.id = p.id
   and ranked.place <= 3;
