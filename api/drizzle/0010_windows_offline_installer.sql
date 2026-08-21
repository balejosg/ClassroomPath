CREATE TABLE IF NOT EXISTS "cp_windows_offline_download_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(50) NOT NULL,
	"classroom_id" varchar(50) NOT NULL,
	"classroom_name" text NOT NULL,
	"reference_hash" text NOT NULL UNIQUE,
	"artifact_sha256" text NOT NULL,
	"artifact_size" bigint NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"used_attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_by" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cp_woi_refs_org" ON "cp_windows_offline_download_refs" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cp_woi_refs_expires" ON "cp_windows_offline_download_refs" ("expires_at") WHERE "consumed_at" IS NULL;
