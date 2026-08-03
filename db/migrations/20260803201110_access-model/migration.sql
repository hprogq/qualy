-- destructive: approved
-- owner: @qualy/plugin-rbac
--
-- Two questions, two answers.
--
-- A user type says what someone is and where they may stand. A role says
-- what someone does, what that lets them do, and where the duty applies. The
-- old model had user types carrying permissions, then carrying roles, and in
-- both shapes "why does this person have this" was a union of sources while
-- roles had to double as identity traits. That is what made "roles restrict
-- which user types may hold them" and "user types confer roles" circle each
-- other.
--
-- So: user types gain the constraint they were missing (where their people
-- may be placed) and lose every trace of authority. Roles keep permissions
-- and eligibility. A grant connects them.
--
-- Existing authority is preserved. Whatever a user type conferred becomes an
-- explicit grant of an equivalent role to each of its members, so nobody
-- gains or loses a capability by being migrated.

-- the channel triggers read columns this migration removes
DROP TRIGGER IF EXISTS trg_user_type_permissions_channel ON user_type_permissions;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_role_permissions_channel ON role_permissions;--> statement-breakpoint
DROP FUNCTION IF EXISTS check_user_type_permission_channel();--> statement-breakpoint
DROP FUNCTION IF EXISTS check_role_permission_channel();--> statement-breakpoint

-- Preflight against the identifiers this migration generates. Discovering a
-- collision halfway through would leave a tenant with its user-type
-- permissions dropped and nothing holding them. The identifiers derive from
-- the user type's id, not its code: a code may be 63 characters and a role
-- code may not be longer.
DO $$
DECLARE clash text;
BEGIN
  SELECT string_agg(r.code, ', ') INTO clash
  FROM roles r JOIN user_types ut ON ut.tenant_id = r.tenant_id
  WHERE r.code = 'migrated-' || replace(ut.id::text, '-', '');
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'role codes % would collide with the roles this migration generates', clash;
  END IF;
  SELECT string_agg(r.name, ', ') INTO clash
  FROM roles r JOIN user_types ut ON ut.tenant_id = r.tenant_id
  WHERE r.name = left(ut.name, 80) || ' 原有权限 #' || left(replace(ut.id::text, '-', ''), 6);
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'role names % would collide with the roles this migration generates', clash;
  END IF;
END $$;--> statement-breakpoint

-- Permission codes that moved domain. The rows keep their identity, so every
-- role_permissions row referencing them keeps working; inserting new rows
-- would have left existing roles holding capabilities nothing answers to.
DO $$
DECLARE clash text;
BEGIN
  SELECT string_agg(code, ', ') INTO clash FROM permissions
  WHERE code IN ('iam.role.read', 'iam.role.manage', 'iam.grant.read', 'iam.grant.manage')
    AND EXISTS (SELECT 1 FROM permissions old WHERE old.code = CASE permissions.code
      WHEN 'iam.role.read' THEN 'rbac.role.read'
      WHEN 'iam.role.manage' THEN 'rbac.role.manage'
      WHEN 'iam.grant.read' THEN 'rbac.assignment.read'
      WHEN 'iam.grant.manage' THEN 'rbac.assignment.manage' END);
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'both the old and new form of % exist; resolve by hand', clash;
  END IF;
END $$;--> statement-breakpoint
UPDATE permissions SET code = CASE code
    WHEN 'rbac.role.read' THEN 'iam.role.read'
    WHEN 'rbac.role.manage' THEN 'iam.role.manage'
    WHEN 'rbac.assignment.read' THEN 'iam.grant.read'
    WHEN 'rbac.assignment.manage' THEN 'iam.grant.manage'
    ELSE code END
WHERE code IN ('rbac.role.read', 'rbac.role.manage',
  'rbac.assignment.read', 'rbac.assignment.manage');--> statement-breakpoint

-- the recovery account is an identity, not an authority: administrator power
-- comes from the tenant-admin role, and an ordinary teacher may hold it
UPDATE user_types SET code = 'system-account', name = '系统账户'
WHERE code = 'administrator' AND is_system
  AND NOT EXISTS (
    SELECT 1 FROM user_types other
    WHERE other.tenant_id = user_types.tenant_id AND other.code = 'system-account');--> statement-breakpoint

CREATE TABLE "role_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"org_node_id" uuid,
	"coverage" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_role_grants_coverage" CHECK ("coverage" IN ('self', 'subtree')),
	CONSTRAINT "chk_role_grants_anchor" CHECK (("org_node_id" IS NULL) = ("coverage" IS NULL))
);--> statement-breakpoint
CREATE TABLE "user_type_allowed_org_types" (
	"tenant_id" uuid NOT NULL,
	"user_type_id" uuid NOT NULL,
	"org_type_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_user_type_allowed_org_types" PRIMARY KEY("tenant_id","user_type_id","org_type_id")
);--> statement-breakpoint

ALTER TABLE "permissions" ADD COLUMN "target_kind" varchar(16);--> statement-breakpoint
UPDATE "permissions" SET "target_kind" = CASE WHEN "scope" = 'org' THEN 'org-node' ELSE 'tenant' END;--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "target_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "status" varchar(16) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "permission_mode" varchar(16) DEFAULT 'explicit' NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "system_key" varchar(63);--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_types" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "roles" SET "status" = CASE WHEN "enabled" THEN 'active' ELSE 'disabled' END;--> statement-breakpoint
UPDATE "roles" SET "system_key" = 'tenant-admin', "permission_mode" = 'all-active',
  "assignable" = true, "kind" = 'tenant', "status" = 'active'
  WHERE "is_system" AND "code" = 'tenant-admin' AND "kind" = 'tenant';--> statement-breakpoint

-- Whatever a user type conferred becomes an explicit grant, per type and per
-- member. A shared role would have given every type the union of what any of
-- them had; leaving it implicit would have kept the very coupling this
-- change removes.
INSERT INTO "roles" ("tenant_id", "code", "name", "kind", "status", "permission_mode")
SELECT DISTINCT ut."tenant_id",
  'migrated-' || replace(ut."id"::text, '-', ''),
  left(ut."name", 80) || ' 原有权限 #' || left(replace(ut."id"::text, '-', ''), 6),
  'tenant', 'active', 'explicit'
FROM "user_types" ut
WHERE EXISTS (SELECT 1 FROM "user_type_permissions" utp
  WHERE utp."tenant_id" = ut."tenant_id" AND utp."user_type_id" = ut."id");--> statement-breakpoint
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
SELECT utp."tenant_id", r."id", utp."permission_id"
FROM "user_type_permissions" utp
JOIN "user_types" ut ON ut."tenant_id" = utp."tenant_id" AND ut."id" = utp."user_type_id"
JOIN "roles" r ON r."tenant_id" = utp."tenant_id"
  AND r."code" = 'migrated-' || replace(ut."id"::text, '-', '')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- every member of that type receives it explicitly, so nothing is lost
INSERT INTO "role_grants" ("tenant_id", "user_id", "role_id", "org_node_id", "coverage")
SELECT DISTINCT u."tenant_id", u."id", r."id", NULL::uuid, NULL::varchar
FROM "users" u
JOIN "roles" r ON r."tenant_id" = u."tenant_id"
  AND r."code" = 'migrated-' || replace(u."user_type_id"::text, '-', '')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- A tenant role's grants all collapse onto the same unanchored row, so two
-- old assignments for the same person and role would become one duplicated
-- key. The earliest is kept, deterministically, rather than letting the
-- unique index fail the whole migration.
INSERT INTO "role_grants" ("id", "tenant_id", "user_id", "role_id", "org_node_id", "coverage", "created_at")
SELECT DISTINCT ON (
    a."tenant_id", a."user_id", a."role_id",
    CASE WHEN r."kind" = 'tenant' THEN NULL ELSE a."org_node_id" END,
    CASE WHEN r."kind" = 'tenant' THEN NULL ELSE a."scope" END)
  a."id", a."tenant_id", a."user_id", a."role_id",
  CASE WHEN r."kind" = 'tenant' THEN NULL ELSE a."org_node_id" END,
  CASE WHEN r."kind" = 'tenant' THEN NULL ELSE a."scope" END,
  a."created_at"
FROM "user_role_assignments" a
JOIN "roles" r ON r."tenant_id" = a."tenant_id" AND r."id" = a."role_id"
ORDER BY a."tenant_id", a."user_id", a."role_id",
  CASE WHEN r."kind" = 'tenant' THEN NULL ELSE a."org_node_id" END,
  CASE WHEN r."kind" = 'tenant' THEN NULL ELSE a."scope" END,
  a."created_at", a."id";--> statement-breakpoint

DROP TABLE "user_role_assignments";--> statement-breakpoint
DROP TABLE "user_type_permissions";--> statement-breakpoint
ALTER TABLE "permissions" DROP CONSTRAINT "chk_permissions_scope";--> statement-breakpoint
ALTER TABLE "permissions" DROP CONSTRAINT "chk_permissions_user_type_scope";--> statement-breakpoint
ALTER TABLE "permissions" DROP CONSTRAINT "chk_permissions_default_admin_channel";--> statement-breakpoint
ALTER TABLE "permissions" DROP COLUMN "scope";--> statement-breakpoint
ALTER TABLE "permissions" DROP COLUMN "grant_to_user_type";--> statement-breakpoint
ALTER TABLE "permissions" DROP COLUMN "grant_to_role";--> statement-breakpoint
ALTER TABLE "permissions" DROP COLUMN "default_tenant_admin";--> statement-breakpoint
ALTER TABLE "permissions" DROP COLUMN "enabled";--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "is_system";--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_role_grants_anchored" ON "role_grants" ("tenant_id","user_id","role_id","org_node_id","coverage") WHERE "org_node_id" IS NOT NULL;;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_role_grants_tenant_wide" ON "role_grants" ("tenant_id","user_id","role_id") WHERE "org_node_id" IS NULL;;--> statement-breakpoint
CREATE INDEX "idx_role_grants_tenant_user" ON "role_grants" ("tenant_id","user_id");;--> statement-breakpoint
CREATE INDEX "idx_role_grants_tenant_node" ON "role_grants" ("tenant_id","org_node_id");;--> statement-breakpoint
CREATE INDEX "idx_role_grants_tenant_role" ON "role_grants" ("tenant_id","role_id");;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_roles_tenant_system_key" ON "roles" ("tenant_id","system_key") WHERE "system_key" IS NOT NULL;;--> statement-breakpoint
CREATE INDEX "idx_user_type_allowed_org_types_tenant_type" ON "user_type_allowed_org_types" ("tenant_id","user_type_id");;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "fk_role_grants_user" FOREIGN KEY ("tenant_id","user_id") REFERENCES "users"("tenant_id","id") ON DELETE CASCADE;;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "fk_role_grants_role" FOREIGN KEY ("tenant_id","role_id") REFERENCES "roles"("tenant_id","id") ON DELETE CASCADE;;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "fk_role_grants_node" FOREIGN KEY ("tenant_id","org_node_id") REFERENCES "org_nodes"("tenant_id","id") ON DELETE RESTRICT;;--> statement-breakpoint
ALTER TABLE "user_type_allowed_org_types" ADD CONSTRAINT "user_type_allowed_org_types_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;;--> statement-breakpoint
ALTER TABLE "user_type_allowed_org_types" ADD CONSTRAINT "fk_user_type_allowed_org_types_type" FOREIGN KEY ("tenant_id","user_type_id") REFERENCES "user_types"("tenant_id","id") ON DELETE CASCADE;;--> statement-breakpoint
ALTER TABLE "user_type_allowed_org_types" ADD CONSTRAINT "fk_user_type_allowed_org_types_org_type" FOREIGN KEY ("tenant_id","org_type_id") REFERENCES "org_types"("tenant_id","id") ON DELETE RESTRICT;;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "chk_permissions_target_kind" CHECK ("target_kind" IN ('tenant', 'org-node'));;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "chk_roles_status" CHECK ("status" IN ('draft', 'active', 'disabled'));;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "chk_roles_permission_mode" CHECK ("permission_mode" IN ('explicit', 'all-active'));;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "chk_roles_all_active_is_system" CHECK ("permission_mode" <> 'all-active' OR "system_key" = 'tenant-admin');;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "chk_roles_tenant_admin_shape" CHECK ("system_key" <> 'tenant-admin' OR (
        "permission_mode" = 'all-active' AND "kind" = 'tenant'
        AND "status" = 'active' AND "assignable"));;
