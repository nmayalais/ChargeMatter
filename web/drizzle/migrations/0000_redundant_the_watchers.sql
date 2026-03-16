CREATE TABLE "chargers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"max_minutes" integer NOT NULL,
	"slot_starts" text NOT NULL,
	"active_session_id" text
);
--> statement-breakpoint
CREATE TABLE "config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charger_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text DEFAULT '' NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"checked_in_at" timestamp with time zone,
	"no_show_at" timestamp with time zone,
	"no_show_strike_at" timestamp with time zone,
	"reminder_5_before_sent" boolean DEFAULT false NOT NULL,
	"reminder_5_after_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"canceled_at" timestamp with time zone,
	"released_early" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charger_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text DEFAULT '' NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"overdue" boolean DEFAULT false NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"reminder_10_sent" boolean DEFAULT false NOT NULL,
	"reminder_5_sent" boolean DEFAULT false NOT NULL,
	"reminder_0_sent" boolean DEFAULT false NOT NULL,
	"overdue_last_sent_at" timestamp with time zone,
	"grace_notified_at" timestamp with time zone,
	"late_strike_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "strikes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"source_type" text DEFAULT '' NOT NULL,
	"source_id" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"month_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suspensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text DEFAULT '' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_charger_id_chargers_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."chargers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_charger_id_chargers_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."chargers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reservations_user_id" ON "reservations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_reservations_charger_id" ON "reservations" USING btree ("charger_id");--> statement-breakpoint
CREATE INDEX "idx_reservations_start_time" ON "reservations" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_charger_id" ON "sessions" USING btree ("charger_id");--> statement-breakpoint
CREATE INDEX "idx_strikes_user_month" ON "strikes" USING btree ("user_id","month_key");--> statement-breakpoint
CREATE INDEX "idx_suspensions_user_active" ON "suspensions" USING btree ("user_id");