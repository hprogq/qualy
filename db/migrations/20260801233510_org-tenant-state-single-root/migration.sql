ALTER TABLE "tenants" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_nodes_tenant_single_root" ON "org_nodes" ("tenant_id") WHERE "parent_id" IS NULL;