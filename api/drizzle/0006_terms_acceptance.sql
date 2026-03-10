CREATE TABLE "cp_terms_acceptance" (
  "user_id" varchar(50) PRIMARY KEY NOT NULL,
  "terms_version" varchar(50) NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
