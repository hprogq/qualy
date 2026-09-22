-- owner: @qualy/plugin-auth
-- destructive: approved
-- Deleting a person is final. The row stays as a tombstone that history names
-- by id, but nothing restores it, so what it held - a business number, and
-- from now on an email address - is free for whoever is given it next. Both
-- are unique among the living only.
drop index "uq_users_tenant_business_no";

create unique index "uq_users_tenant_business_no" on "users" ("tenant_id", "business_no") where (deleted_at IS NULL) AND (business_no IS NOT NULL);

-- One email per person: notifications go to it, and the password door signs
-- in by it. Stored the way it is compared, so the index sees one spelling.
alter table "users" add "email" varchar(254) null, add "email_verified_at" timestamptz(6) null;

alter table "users" add constraint "chk_users_email_normalized" check (email = lower(btrim(email)));

create unique index "uq_users_tenant_email_live" on "users" ("tenant_id", "email") where (deleted_at IS NULL) AND (email IS NOT NULL);

-- With nothing to restore, the permission to restore describes nothing. A
-- database upgraded from an earlier release still carries the code in the
-- catalog and in whatever roles had it ticked; a stale row reads as a promise.
delete from batch_access_source_permissions where permission_code = 'auth.user.restore';

delete from batch_access_denies where permission_code = 'auth.user.restore';

delete from role_permissions rp
 using permissions p
 where p.id = rp.permission_id
   and p.code = 'auth.user.restore';

delete from permissions where code = 'auth.user.restore';
