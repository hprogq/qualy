CREATE TABLE "org_nodes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"org_type_id" uuid NOT NULL,
	"code" varchar(63),
	"name" varchar(255) NOT NULL,
	"path" ltree NOT NULL,
	"depth" smallint DEFAULT 0 NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_org_nodes_code_format" CHECK ("code" IS NULL OR "code" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "chk_org_nodes_name_not_blank" CHECK (btrim("name") <> ''),
	CONSTRAINT "chk_org_nodes_depth_non_negative" CHECK ("depth" >= 0),
	CONSTRAINT "chk_org_nodes_sort_order_non_negative" CHECK ("sort_order" >= 0),
	CONSTRAINT "chk_org_nodes_parent_not_self" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);
--> statement-breakpoint
CREATE TABLE "org_type_rules" (
	"tenant_id" uuid,
	"parent_type_id" uuid,
	"child_type_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_org_type_rules" PRIMARY KEY("tenant_id","parent_type_id","child_type_id"),
	CONSTRAINT "chk_org_type_rules_no_self_loop" CHECK ("parent_type_id" <> "child_type_id")
);
--> statement-breakpoint
CREATE TABLE "org_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"code" varchar(63) NOT NULL,
	"name" varchar(100) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_org_types_code_format" CHECK ("code" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "chk_org_types_name_not_blank" CHECK (btrim("name") <> ''),
	CONSTRAINT "chk_org_types_sort_order_non_negative" CHECK ("sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"slug" varchar(63) NOT NULL UNIQUE,
	"name" varchar(255) NOT NULL,
	"logo_url" varchar(2048),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_tenants_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "chk_tenants_name_not_blank" CHECK (btrim("name") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_nodes_tenant_id_id" ON "org_nodes" ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_nodes_tenant_code" ON "org_nodes" ("tenant_id","code") WHERE "code" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_nodes_tenant_parent_name" ON "org_nodes" ("tenant_id","parent_id","name") WHERE "parent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_nodes_tenant_root_name" ON "org_nodes" ("tenant_id","name") WHERE "parent_id" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_org_nodes_parent_sort" ON "org_nodes" ("tenant_id","parent_id","sort_order","name");--> statement-breakpoint
CREATE INDEX "idx_org_nodes_path_gist" ON "org_nodes" USING gist ("path");--> statement-breakpoint
CREATE INDEX "idx_org_type_rules_tenant_child" ON "org_type_rules" ("tenant_id","child_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_types_tenant_id_id" ON "org_types" ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_types_tenant_code" ON "org_types" ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_types_tenant_name" ON "org_types" ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "org_nodes" ADD CONSTRAINT "org_nodes_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org_nodes" ADD CONSTRAINT "fk_org_nodes_parent" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "org_nodes"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "org_nodes" ADD CONSTRAINT "fk_org_nodes_org_type" FOREIGN KEY ("tenant_id","org_type_id") REFERENCES "org_types"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "org_type_rules" ADD CONSTRAINT "org_type_rules_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org_type_rules" ADD CONSTRAINT "fk_org_type_rules_parent" FOREIGN KEY ("tenant_id","parent_type_id") REFERENCES "org_types"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org_type_rules" ADD CONSTRAINT "fk_org_type_rules_child" FOREIGN KEY ("tenant_id","child_type_id") REFERENCES "org_types"("tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org_types" ADD CONSTRAINT "org_types_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;