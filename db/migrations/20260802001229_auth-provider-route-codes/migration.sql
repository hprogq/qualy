ALTER TABLE "auth_providers" DROP CONSTRAINT "chk_auth_providers_code_not_blank";--> statement-breakpoint
ALTER TABLE "auth_providers" ADD COLUMN "sort_order" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_providers" ADD CONSTRAINT "chk_auth_providers_code_format" CHECK ("code" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');--> statement-breakpoint
ALTER TABLE "auth_providers" ADD CONSTRAINT "chk_auth_providers_type_format" CHECK ("type" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');--> statement-breakpoint
ALTER TABLE "auth_providers" ADD CONSTRAINT "chk_auth_providers_sort_order_non_negative" CHECK ("sort_order" >= 0);