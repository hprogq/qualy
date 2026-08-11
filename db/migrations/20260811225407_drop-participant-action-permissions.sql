-- owner: @qualy/plugin-assessment
-- destructive: approved
-- A participant's own actions stopped being rbac permissions: authority over
-- one's own entries comes from being on a roster, and no grant can put
-- somebody in a round they are not in. The rows are removed rather than left
-- inert, because a code sitting in `permissions` is one the tenant
-- administrator holds by definition (permission_mode = 'all-active') and one
-- that any future catalog read would offer again.
--
-- Grants first: role_permissions references permissions.
delete from role_permissions rp
 using permissions p
 where p.id = rp.permission_id
   and p.code in (
     'assessment.entry.create',
     'assessment.entry.edit',
     'assessment.entry.submit',
     'assessment.entry.withdraw',
     'assessment.result.view-self'
   );

delete from permissions
 where code in (
   'assessment.entry.create',
   'assessment.entry.edit',
   'assessment.entry.submit',
   'assessment.entry.withdraw',
   'assessment.result.view-self'
 );
