-- A check that evaluates to null is satisfied, so with a null system_key
-- `permission_mode <> 'all-active' OR system_key = 'tenant-admin'` accepted
-- exactly the row it forbids: a second role holding every capability at
-- every node. No api path writes it, which is why the guarantee belongs in
-- the database rather than in a service, and why the hole mattered.
--
-- Any such row must go before the tightened check can be trusted, and
-- deleting one silently would be deleting authority somebody may hold. The
-- migration names them instead.
DO $$
DECLARE usurpers text;
BEGIN
  SELECT string_agg(DISTINCT "code", ', ') INTO usurpers FROM "roles"
  WHERE "permission_mode" = 'all-active' AND "system_key" IS DISTINCT FROM 'tenant-admin';
  IF usurpers IS NOT NULL THEN
    RAISE EXCEPTION 'roles hold every capability without being the canonical administrator: %; remove them before migrating', usurpers;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "chk_roles_all_active_is_system", ADD CONSTRAINT "chk_roles_all_active_is_system" CHECK ("permission_mode" <> 'all-active'
        OR "system_key" IS NOT DISTINCT FROM 'tenant-admin');