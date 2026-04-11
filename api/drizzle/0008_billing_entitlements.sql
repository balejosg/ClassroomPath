CREATE TABLE IF NOT EXISTS "cp_billing_checkout_intents" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"organization_id" varchar(50),
	"organization_name" varchar(255) NOT NULL,
	"kind" varchar(30) NOT NULL,
	"status" varchar(30) NOT NULL,
	"classrooms" integer NOT NULL,
	"stripe_checkout_session_id" varchar(255),
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"stripe_payment_intent_id" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cp_billing_checkout_session_key" UNIQUE("stripe_checkout_session_id")
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cp_billing_checkout_intents" ADD CONSTRAINT "cp_billing_checkout_intents_organization_id_cp_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cp_billing_checkout_user_idx" ON "cp_billing_checkout_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cp_organization_entitlements" (
	"organization_id" varchar(50) PRIMARY KEY NOT NULL,
	"source" varchar(50) NOT NULL,
	"status" varchar(30) NOT NULL,
	"product_kind" varchar(50) NOT NULL,
	"classroom_limit" integer NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"stripe_checkout_session_id" varchar(255),
	"current_period_end" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"granted_by" varchar(50),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cp_organization_entitlements" ADD CONSTRAINT "cp_organization_entitlements_organization_id_cp_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cp_billing_manual_requests" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"organization_id" varchar(50),
	"organization_name" varchar(255) NOT NULL,
	"kind" varchar(50) NOT NULL,
	"classrooms" integer NOT NULL,
	"status" varchar(30) NOT NULL,
	"note" text,
	"reviewed_by" varchar(50),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cp_billing_manual_requests" ADD CONSTRAINT "cp_billing_manual_requests_organization_id_cp_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cp_stripe_webhook_events" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"type" varchar(100) NOT NULL,
	"processed_at" timestamp with time zone NOT NULL
);
