ALTER TABLE "cp_organization_entitlements"
	ADD COLUMN IF NOT EXISTS "grace_ends_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false NOT NULL,
	ADD COLUMN IF NOT EXISTS "last_stripe_event_type" varchar(100),
	ADD COLUMN IF NOT EXISTS "last_stripe_event_id" varchar(255);--> statement-breakpoint
ALTER TABLE "cp_billing_manual_requests"
	ADD COLUMN IF NOT EXISTS "resolution_note" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cp_billing_audit_events" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"organization_id" varchar(50),
	"actor_type" varchar(30) NOT NULL,
	"actor_id" varchar(50),
	"action" varchar(100) NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"target_id" varchar(50) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cp_billing_audit_events" ADD CONSTRAINT "cp_billing_audit_events_organization_id_cp_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cp_billing_audit_org_idx" ON "cp_billing_audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cp_billing_audit_target_idx" ON "cp_billing_audit_events" USING btree ("target_type","target_id","created_at");
