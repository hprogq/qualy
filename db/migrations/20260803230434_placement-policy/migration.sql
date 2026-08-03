-- Added with a default so the backfill below has something to write over,
-- then stripped of it: from here every writer names its policy, including
-- seeds and import scripts that never pass through the http contract. A
-- column default would let them create an unconstrained type by omission,
-- which is the reading this migration exists to remove.
ALTER TABLE "user_types" ADD COLUMN "placement_mode" varchar(16) DEFAULT 'unrestricted' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_types" ADD CONSTRAINT "chk_user_types_placement_mode" CHECK ("placement_mode" in ('unrestricted', 'allow-list'));--> statement-breakpoint

-- The list used to carry the whole meaning, with "no rows" read as
-- "anywhere". Existing rows keep exactly the behaviour they had, now said
-- out loud, so that clearing the list from here on is a narrowing rather
-- than a silent widening.
UPDATE "user_types" ut SET "placement_mode" = 'allow-list'
WHERE EXISTS (SELECT 1 FROM "user_type_allowed_org_types" a
  WHERE a."tenant_id" = ut."tenant_id" AND a."user_type_id" = ut."id");--> statement-breakpoint

-- The previous migration renamed the recovery type only when the new name
-- was free, which could leave a tenant holding both and no way to tell which
-- one the runtime means. A mixed state is worse than a stopped migration.
DO $$
DECLARE mixed int;
BEGIN
  SELECT count(*) INTO mixed FROM "user_types" a
  JOIN "user_types" b ON b."tenant_id" = a."tenant_id"
  WHERE a."code" = 'administrator' AND a."is_system" AND b."code" = 'system-account';
  IF mixed > 0 THEN
    RAISE EXCEPTION 'tenant holds both administrator and system-account user types; resolve by hand before migrating';
  END IF;
END $$;--> statement-breakpoint

-- "May enter the portal" is authentication state, not a capability, and the
-- pages that used to depend on it now declare AUTHENTICATED visibility. It
-- was converted along with everything else, so the compatibility roles carry
-- a permission the registry no longer defines.
DELETE FROM "role_permissions" rp USING "permissions" p
WHERE p."id" = rp."permission_id" AND p."code" = 'auth.portal.access';--> statement-breakpoint
DELETE FROM "permissions" WHERE "code" = 'auth.portal.access';--> statement-breakpoint

-- A role authored by an administrator whose only capability was portal
-- access is now active and empty, which the lifecycle exists to prevent.
-- Deleting it would destroy their work and disabling it would change who can
-- do what, so the migration stops and names them: which of the three it
-- should be is their decision, not this file's.
DO $$
DECLARE stranded text;
BEGIN
  SELECT string_agg(DISTINCT r."code", ', ') INTO stranded FROM "roles" r
  WHERE r."permission_mode" = 'explicit' AND r."status" = 'active'
    AND r."code" !~ '^migrated-[0-9a-f]{32}$'
    AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."role_id" = r."id");
  IF stranded IS NOT NULL THEN
    RAISE EXCEPTION 'active roles left with no permissions: %; delete, disable or give them capabilities before migrating', stranded;
  END IF;
END $$;--> statement-breakpoint

-- The compatibility roles this migration's predecessor generated, named
-- exactly rather than by prefix: 'migrated-' is a perfectly ordinary start
-- to a code an administrator may have chosen, and only the generated ones
-- carry the source type's id.
DELETE FROM "role_grants" g USING "roles" r
WHERE r."id" = g."role_id" AND r."code" ~ '^migrated-[0-9a-f]{32}$'
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."role_id" = r."id");--> statement-breakpoint
DELETE FROM "roles" r
WHERE r."code" ~ '^migrated-[0-9a-f]{32}$'
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."role_id" = r."id");--> statement-breakpoint

-- These exist to preserve what their members already had, not to become new
-- business roles: leaving them offerable would have moved a technical
-- artefact into the catalogue administrators pick from. Matched by joining
-- the user type they came from, so nothing else can be caught by the name.
UPDATE "roles" r SET "assignable" = false, "description" = 'migrated compatibility role'
FROM "user_types" ut
WHERE ut."tenant_id" = r."tenant_id"
  AND r."code" = 'migrated-' || replace(ut."id"::text, '-', '');--> statement-breakpoint

-- Every role now declares who may hold it, tenant-kind included. A migrated
-- role came from exactly one user type, so that type is its eligible set and
-- the rule holds without widening anyone's reach.
INSERT INTO "role_allowed_user_types" ("tenant_id", "role_id", "user_type_id")
SELECT r."tenant_id", r."id", ut."id"
FROM "roles" r
JOIN "user_types" ut ON ut."tenant_id" = r."tenant_id"
  AND r."code" = 'migrated-' || replace(ut."id"::text, '-', '')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- A system identity stands at the tenant root and nowhere else, because
-- authority over a person is authority over the node they stand at. Stopping
-- is the honest answer: moving somebody silently would be a policy decision
-- a migration has no business making.
DO $$
DECLARE misplaced int;
BEGIN
  SELECT count(*) INTO misplaced FROM "users" u
  JOIN "user_types" t ON t."tenant_id" = u."tenant_id" AND t."id" = u."user_type_id"
  JOIN "org_nodes" n ON n."tenant_id" = u."tenant_id" AND n."id" = u."primary_org_node_id"
  WHERE t."is_system" AND n."parent_id" IS NOT NULL;
  IF misplaced > 0 THEN
    RAISE EXCEPTION 'system-type users stand below the tenant root; move them to the root before migrating';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "user_types" ALTER COLUMN "placement_mode" DROP DEFAULT;
