CREATE TABLE "cp_invitations" (
  "id" varchar(50) PRIMARY KEY NOT NULL,
  "organization_id" varchar(50) NOT NULL,
  "email" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "role" varchar(20) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "invited_by" varchar(50) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "cp_invitations"
  ADD CONSTRAINT "cp_invitations_organization_id_cp_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cp_invitations"
  ADD CONSTRAINT "cp_invitations_token_hash_key" UNIQUE("token_hash");--> statement-breakpoint
ALTER TABLE "cp_invitations"
  ADD CONSTRAINT "cp_invitations_org_email_key" UNIQUE("organization_id","email");
