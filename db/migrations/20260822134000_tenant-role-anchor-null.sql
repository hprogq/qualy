-- owner: @qualy/plugin-rbac
-- A tenant role anchors to nothing, and now stores nothing. The relaxation
-- has to come first: the stand-in rows being nulled are the very rows the
-- old NOT NULL still guards.
alter table "roles" drop constraint "chk_roles_anchor_mode";

alter table "roles" alter column "anchor_mode" drop default;

alter table "roles" alter column "anchor_mode" drop not null;

update roles set anchor_mode = null where kind = 'tenant';

delete from role_allowed_org_types t
using roles r
where r.tenant_id = t.tenant_id and r.id = t.role_id and r.kind = 'tenant';

alter table "roles" add constraint "chk_roles_anchor_kind" check ((kind = 'org'::text) = (anchor_mode IS NOT NULL));

alter table "roles" add constraint "chk_roles_anchor_mode" check (anchor_mode IS NULL OR anchor_mode = 'unrestricted' OR anchor_mode = 'allow-list');
