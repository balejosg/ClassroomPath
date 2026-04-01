CREATE TABLE IF NOT EXISTS "cp_audit_events" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"organization_id" varchar(50) NOT NULL,
	"actor_user_id" varchar(50) NOT NULL,
	"action" varchar(100) NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"target_id" varchar(50) NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cp_audit_events" ADD CONSTRAINT "cp_audit_events_organization_id_cp_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cp_mutation_operations" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"operation_type" varchar(100) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"status" varchar(20) NOT NULL,
	"current_step" varchar(50) NOT NULL,
	"organization_id" varchar(50),
	"user_id" varchar(50),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	CONSTRAINT "cp_mutation_operations_type_key" UNIQUE("operation_type","idempotency_key")
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cp_mutation_operations" ADD CONSTRAINT "cp_mutation_operations_organization_id_cp_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cp_mutation_operations_status_idx" ON "cp_mutation_operations" USING btree ("status","updated_at");
