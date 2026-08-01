CREATE TABLE "auth_providers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"code" varchar(63) NOT NULL,
	"type" varchar(32) NOT NULL,
	"name" varchar(100) NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_auth_providers_code_not_blank" CHECK (btrim("code") <> '')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"login_ip" inet,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"auth_provider_id" uuid NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"credential_hash" text,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"code" varchar(63) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"allow_local_login" boolean DEFAULT false NOT NULL,
	"allow_sso_login" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_user_types_code_format" CHECK ("code" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "chk_user_types_name_not_blank" CHECK (btrim("name") <> ''),
	CONSTRAINT "chk_user_types_sort_order_non_negative" CHECK ("sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"business_no" varchar(64),
	"display_name" varchar(100) NOT NULL,
	"user_type_id" uuid NOT NULL,
	"primary_org_node_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_users_display_name_not_blank" CHECK (btrim("display_name") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_auth_providers_tenant_id_id" ON "auth_providers" ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_auth_providers_tenant_code" ON "auth_providers" ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "idx_sessions_tenant_user_expires" ON "sessions" ("tenant_id","user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_identities_tenant_id_id" ON "user_identities" ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_identities_login" ON "user_identities" ("tenant_id","auth_provider_id","identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_identities_user_provider" ON "user_identities" ("tenant_id","user_id","auth_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_types_tenant_id_id" ON "user_types" ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_types_tenant_code" ON "user_types" ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_types_tenant_name" ON "user_types" ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_tenant_id_id" ON "users" ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_tenant_business_no" ON "users" ("tenant_id","business_no") WHERE "business_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_users_tenant_user_type" ON "users" ("tenant_id","user_type_id");--> statement-breakpoint
CREATE INDEX "idx_users_tenant_org_node_name" ON "users" ("tenant_id","primary_org_node_id","display_name");--> statement-breakpoint
ALTER TABLE "auth_providers" ADD CONSTRAINT "auth_providers_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_user" FOREIGN KEY ("tenant_id","user_id") REFERENCES "users"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "fk_user_identities_user" FOREIGN KEY ("tenant_id","user_id") REFERENCES "users"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "fk_user_identities_provider" FOREIGN KEY ("tenant_id","auth_provider_id") REFERENCES "auth_providers"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "user_types" ADD CONSTRAINT "user_types_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "fk_users_user_type" FOREIGN KEY ("tenant_id","user_type_id") REFERENCES "user_types"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "fk_users_primary_org_node" FOREIGN KEY ("tenant_id","primary_org_node_id") REFERENCES "org_nodes"("tenant_id","id") ON DELETE RESTRICT;