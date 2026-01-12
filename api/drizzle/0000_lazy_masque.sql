CREATE TABLE "cp_memberships" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"organization_id" varchar(50) NOT NULL,
	"role" varchar(20) NOT NULL,
	"invited_by" varchar(50),
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cp_memberships_user_org_key" UNIQUE("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "cp_organization_classrooms" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"organization_id" varchar(50) NOT NULL,
	"classroom_id" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cp_org_classroom_key" UNIQUE("organization_id","classroom_id")
);
--> statement-breakpoint
CREATE TABLE "cp_organization_groups" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"organization_id" varchar(50) NOT NULL,
	"group_id" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cp_org_group_key" UNIQUE("organization_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "cp_organization_users" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"organization_id" varchar(50) NOT NULL,
	"openpath_user_id" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cp_org_user_key" UNIQUE("organization_id","openpath_user_id")
);
--> statement-breakpoint
CREATE TABLE "cp_organizations" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_by" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cp_user_status" (
	"user_id" varchar(50) PRIMARY KEY NOT NULL,
	"status" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "cp_memberships" ADD CONSTRAINT "cp_memberships_organization_id_cp_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cp_organization_classrooms" ADD CONSTRAINT "cp_organization_classrooms_organization_id_cp_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cp_organization_groups" ADD CONSTRAINT "cp_organization_groups_organization_id_cp_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cp_organization_users" ADD CONSTRAINT "cp_organization_users_organization_id_cp_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."cp_organizations"("id") ON DELETE cascade ON UPDATE no action;