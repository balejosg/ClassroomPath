CREATE TABLE "cp_group_template_rules" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"template_id" varchar(50) NOT NULL,
	"type" varchar(50) NOT NULL,
	"value" varchar(500) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cp_group_template_rules_template_type_value_key" UNIQUE("template_id","type","value")
);
--> statement-breakpoint
CREATE TABLE "cp_group_templates" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"created_by" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cp_group_templates_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "cp_group_template_rules" ADD CONSTRAINT "cp_group_template_rules_template_id_cp_group_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."cp_group_templates"("id") ON DELETE cascade ON UPDATE no action;