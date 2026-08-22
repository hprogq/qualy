-- owner: @qualy/plugin-auth
-- Who may sign in moves from two booleans on the user type to the door's
-- own audience: each provider says who it admits, unrestricted or exactly
-- the listed types. The local provider inherits the old flags faithfully -
-- an allow-list of the types that had password sign-in open - so nobody's
-- ability to sign in changes with the shape.
alter table auth_providers add column if not exists audience_mode varchar(16) not null default 'unrestricted';

alter table auth_providers add column if not exists version int not null default 1;

alter table auth_providers add constraint chk_auth_providers_audience_mode check (audience_mode = 'unrestricted' or audience_mode = 'allow-list');

create table if not exists auth_provider_user_types (
  id uuid not null default uuidv7() primary key,
  tenant_id uuid not null,
  auth_provider_id uuid not null,
  user_type_id uuid not null,
  created_at timestamptz not null default now(),
  constraint auth_provider_user_types_tenant_id_tenants_id_fkey
    foreign key (tenant_id) references tenants (id) on update cascade on delete cascade
);

create unique index uq_auth_provider_user_types_row on auth_provider_user_types (tenant_id, auth_provider_id, user_type_id);

create index idx_auth_provider_user_types_tenant_type on auth_provider_user_types (tenant_id, user_type_id);

alter table auth_provider_user_types add constraint fk_auth_provider_user_types_provider
  foreign key (tenant_id, auth_provider_id) references auth_providers (tenant_id, id) on delete cascade;

alter table auth_provider_user_types add constraint fk_auth_provider_user_types_type
  foreign key (tenant_id, user_type_id) references user_types (tenant_id, id) on delete cascade;

update auth_providers p set audience_mode = 'allow-list' where p.type = 'local';

insert into auth_provider_user_types (tenant_id, auth_provider_id, user_type_id)
select p.tenant_id, p.id, t.id
from auth_providers p
join user_types t on t.tenant_id = p.tenant_id
where p.type = 'local' and t.allow_local_login = true
on conflict do nothing;
