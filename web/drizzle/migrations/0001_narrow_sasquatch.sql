CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
