-- owner: @qualy/plugin-assessment
-- destructive: approved
-- Asking for a decided entry to be looked at again is the participant's move
-- (design §32.14): a member of staff who wants another look reopens the
-- review, which is a different code. So `assessment.entry.resubmit` left the
-- rbac catalog with the other participant actions - but it left later than
-- they did, and the earlier cleanup does not name it.
--
-- A database upgraded from that release still carries the code: in
-- `permissions`, in whatever roles had it ticked, and in the ceilings and
-- refusals of batches that accepted it as staff authority. The running code
-- no longer honours any of it, which is precisely why it must not be left
-- lying there: a tenant administrator holds every code in the catalog by
-- definition, and a stale ceiling is a promise the next reader may believe.
delete from batch_access_source_permissions where permission_code = 'assessment.entry.resubmit';

delete from batch_access_denies where permission_code = 'assessment.entry.resubmit';

delete from role_permissions rp
 using permissions p
 where p.id = rp.permission_id
   and p.code = 'assessment.entry.resubmit';

delete from permissions where code = 'assessment.entry.resubmit';
