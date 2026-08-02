CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"code" varchar(127) NOT NULL,
	"plugin" varchar(127) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"group_key" varchar(63),
	"scope" varchar(16) NOT NULL,
	"grant_to_user_type" boolean NOT NULL,
	"grant_to_role" boolean NOT NULL,
	"default_tenant_admin" boolean NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_permissions_code_format" CHECK ("code" ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
	CONSTRAINT "chk_permissions_scope" CHECK ("scope" IN ('tenant', 'org')),
	CONSTRAINT "chk_permissions_user_type_scope" CHECK (NOT "grant_to_user_type" OR "scope" = 'tenant')
);
--> statement-breakpoint
CREATE TABLE "role_allowed_org_types" (
	"tenant_id" uuid,
	"role_id" uuid,
	"org_type_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_role_allowed_org_types" PRIMARY KEY("tenant_id","role_id","org_type_id")
);
--> statement-breakpoint
CREATE TABLE "role_allowed_user_types" (
	"tenant_id" uuid,
	"role_id" uuid,
	"user_type_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_role_allowed_user_types" PRIMARY KEY("tenant_id","role_id","user_type_id")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"tenant_id" uuid,
	"role_id" uuid,
	"permission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_role_permissions" PRIMARY KEY("tenant_id","role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"code" varchar(63) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"kind" varchar(16) NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"assignable" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_roles_code_format" CHECK ("code" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "chk_roles_name_not_blank" CHECK (btrim("name") <> ''),
	CONSTRAINT "chk_roles_kind" CHECK ("kind" IN ('tenant', 'org'))
);
--> statement-breakpoint
CREATE TABLE "user_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"org_node_id" uuid NOT NULL,
	"scope" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_user_role_assignments_scope" CHECK ("scope" IN ('self', 'subtree'))
);
--> statement-breakpoint
CREATE TABLE "user_type_permissions" (
	"tenant_id" uuid,
	"user_type_id" uuid,
	"permission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_user_type_permissions" PRIMARY KEY("tenant_id","user_type_id","permission_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_permissions_code" ON "permissions" ("code");--> statement-breakpoint
CREATE INDEX "idx_role_permissions_tenant_role" ON "role_permissions" ("tenant_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_roles_tenant_id_id" ON "roles" ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_roles_tenant_code" ON "roles" ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_roles_tenant_name" ON "roles" ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_role_assignments" ON "user_role_assignments" ("tenant_id","user_id","role_id","org_node_id","scope");--> statement-breakpoint
CREATE INDEX "idx_user_role_assignments_tenant_user" ON "user_role_assignments" ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_user_role_assignments_tenant_node" ON "user_role_assignments" ("tenant_id","org_node_id");--> statement-breakpoint
CREATE INDEX "idx_user_role_assignments_tenant_role" ON "user_role_assignments" ("tenant_id","role_id");--> statement-breakpoint
CREATE INDEX "idx_user_type_permissions_tenant_type" ON "user_type_permissions" ("tenant_id","user_type_id");--> statement-breakpoint
ALTER TABLE "role_allowed_org_types" ADD CONSTRAINT "role_allowed_org_types_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "role_allowed_org_types" ADD CONSTRAINT "fk_role_allowed_org_types_role" FOREIGN KEY ("tenant_id","role_id") REFERENCES "roles"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "role_allowed_org_types" ADD CONSTRAINT "fk_role_allowed_org_types_type" FOREIGN KEY ("tenant_id","org_type_id") REFERENCES "org_types"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "role_allowed_user_types" ADD CONSTRAINT "role_allowed_user_types_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "role_allowed_user_types" ADD CONSTRAINT "fk_role_allowed_user_types_role" FOREIGN KEY ("tenant_id","role_id") REFERENCES "roles"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "role_allowed_user_types" ADD CONSTRAINT "fk_role_allowed_user_types_type" FOREIGN KEY ("tenant_id","user_type_id") REFERENCES "user_types"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_role" FOREIGN KEY ("tenant_id","role_id") REFERENCES "roles"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "fk_user_role_assignments_user" FOREIGN KEY ("tenant_id","user_id") REFERENCES "users"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "fk_user_role_assignments_role" FOREIGN KEY ("tenant_id","role_id") REFERENCES "roles"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "fk_user_role_assignments_node" FOREIGN KEY ("tenant_id","org_node_id") REFERENCES "org_nodes"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "user_type_permissions" ADD CONSTRAINT "user_type_permissions_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_type_permissions" ADD CONSTRAINT "user_type_permissions_permission_id_permissions_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_type_permissions" ADD CONSTRAINT "fk_user_type_permissions_type" FOREIGN KEY ("tenant_id","user_type_id") REFERENCES "user_types"("tenant_id","id") ON DELETE CASCADE;