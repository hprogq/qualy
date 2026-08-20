-- owner: @qualy/plugin-rbac
-- destructive: approved
-- The bind escape hatches left the model (re-ruled 2026-08-20). Granting a
-- role to somebody else no longer compares permission sets at all - whether
-- the office is theirs to appoint is the appointment graph's question,
-- settled when the edge is written - and granting a role to oneself must
-- never escalate, with no permission able to say otherwise. A capability
-- whose whole meaning was "may exceed yourself while granting" therefore
-- describes nothing the running code asks any more.
--
-- A database upgraded from an earlier release still carries both codes: in
-- `permissions` and in whatever roles had them ticked. They must not be
-- left lying there - a stale row reads as a promise, and a tenant
-- administrator holds every catalog code by definition.
delete from batch_access_source_permissions
 where permission_code in ('iam.org-role.bind', 'iam.tenant-role.bind');

delete from batch_access_denies
 where permission_code in ('iam.org-role.bind', 'iam.tenant-role.bind');

delete from role_permissions rp
 using permissions p
 where p.id = rp.permission_id
   and p.code in ('iam.org-role.bind', 'iam.tenant-role.bind');

delete from permissions where code in ('iam.org-role.bind', 'iam.tenant-role.bind');
