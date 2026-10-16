CREATE TYPE "public"."championship_status" AS ENUM('DRAFT', 'ACTIVE', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."entry_order_decision" AS ENUM('NO_CHANGE', 'CHANGED');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('INDIVIDUAL_LANCE', 'PAIR_LANCE', 'TEAM_LANCE', 'INDIVIDUAL_SWORD', 'PAIR_SWORD', 'TEAM_SWORD', 'RINGS_AND_PEG_LANCE', 'LEMON_AND_PEG_SWORD', 'RELAY_LANCE', 'RELAY_SWORD');--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('MANAGE_TEMPLATES', 'CREATE_CHAMPIONSHIP', 'EDIT_CHAMPIONSHIP', 'MANAGE_CHAMPIONSHIP_COUNTRIES', 'MANAGE_RIDERS', 'MANAGE_ENTRY_ORDERS', 'ENTER_SCORES', 'CONFIRM_RUNS', 'EDIT_CONFIRMED_RESULTS', 'MANAGE_TIE_BREAKS', 'PRINT_ROUND_SHEETS', 'VIEW_INTERNAL_RESULTS', 'MANAGE_PUBLIC_RESULTS');--> statement-breakpoint
CREATE TYPE "public"."roster_slot" AS ENUM('ACTIVE', 'RESERVE');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('ENTRY_ORDER_PENDING', 'READY', 'IN_PROGRESS', 'REVIEW', 'CONFIRMED');--> statement-breakpoint
CREATE TYPE "public"."standings_scope" AS ENUM('DAY_1', 'DAY_2', 'DAY_3', 'OVERALL');--> statement-breakpoint
CREATE TYPE "public"."standings_subject" AS ENUM('INDIVIDUAL', 'COUNTRY');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"championship_id" uuid,
	"reason" text,
	"before_data" jsonb,
	"after_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"user_id" uuid NOT NULL,
	"permission" "permission" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_user_id" uuid,
	CONSTRAINT "user_permissions_user_id_permission_pk" PRIMARY KEY("user_id","permission")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iso2" char(2) NOT NULL,
	"iso3" char(3) NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "championship_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	CONSTRAINT "template_days_day_number_check" CHECK ("template_days"."day_number" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "template_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_day_id" uuid NOT NULL,
	"event_type" "event_type" NOT NULL,
	"order_index" integer NOT NULL,
	CONSTRAINT "template_events_order_check" CHECK ("template_events"."order_index" >= 1)
);
--> statement-breakpoint
CREATE TABLE "template_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_event_id" uuid NOT NULL,
	"run_number" integer NOT NULL,
	"peg_size_cm" numeric(4, 1) NOT NULL,
	"time_limit_seconds" numeric(6, 2) NOT NULL,
	CONSTRAINT "template_runs_number_check" CHECK ("template_runs"."run_number" >= 1),
	CONSTRAINT "template_runs_peg_check" CHECK ("template_runs"."peg_size_cm" > 0),
	CONSTRAINT "template_runs_time_check" CHECK ("template_runs"."time_limit_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "championship_countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"championship_id" uuid NOT NULL,
	"country_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "championship_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"championship_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"competition_date" date NOT NULL,
	CONSTRAINT "championship_days_number_check" CHECK ("championship_days"."day_number" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "championship_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"championship_day_id" uuid NOT NULL,
	"event_type" "event_type" NOT NULL,
	"order_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "championship_riders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"championship_country_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"roster_slot" "roster_slot" NOT NULL,
	"initial_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "championship_riders_order_check" CHECK (("championship_riders"."roster_slot" = 'ACTIVE' and "championship_riders"."initial_order" between 1 and 4)
          or ("championship_riders"."roster_slot" = 'RESERVE' and "championship_riders"."initial_order" is null))
);
--> statement-breakpoint
CREATE TABLE "championship_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"championship_event_id" uuid NOT NULL,
	"run_number" integer NOT NULL,
	"peg_size_cm" numeric(4, 1) NOT NULL,
	"time_limit_seconds" numeric(6, 2) NOT NULL,
	"status" "run_status" DEFAULT 'ENTRY_ORDER_PENDING' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "championship_runs_number_check" CHECK ("championship_runs"."run_number" >= 1),
	CONSTRAINT "championship_runs_confirmed_check" CHECK (("championship_runs"."status" = 'CONFIRMED') = ("championship_runs"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "championships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"location" text NOT NULL,
	"organizer" text,
	"status" "championship_status" DEFAULT 'DRAFT' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"slug" text NOT NULL,
	"source_template_id" uuid,
	"source_template_name" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_entry_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_entry_order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"championship_rider_id" uuid NOT NULL,
	CONSTRAINT "run_entry_order_items_position_check" CHECK ("run_entry_order_items"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "run_entry_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"championship_country_id" uuid NOT NULL,
	"decision" "entry_order_decision" NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "run_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"reason" text NOT NULL,
	"changed_by_user_id" uuid,
	"changed_by_name" text NOT NULL,
	"before_data" jsonb NOT NULL,
	"after_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_revisions_number_check" CHECK ("run_revisions"."revision_number" >= 1),
	CONSTRAINT "run_revisions_reason_check" CHECK (btrim("run_revisions"."reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "run_score_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_score_id" uuid NOT NULL,
	"target_index" integer NOT NULL,
	"points" numeric(4, 1),
	CONSTRAINT "run_score_targets_index_check" CHECK ("run_score_targets"."target_index" >= 0),
	CONSTRAINT "run_score_targets_points_check" CHECK ("run_score_targets"."points" is null or "run_score_targets"."points" in (0, 2, 4, 6))
);
--> statement-breakpoint
CREATE TABLE "run_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"run_scoring_unit_id" uuid NOT NULL,
	"championship_rider_id" uuid NOT NULL,
	"position_in_unit" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_scores_position_check" CHECK ("run_scores"."position_in_unit" >= 1)
);
--> statement-breakpoint
CREATE TABLE "run_scoring_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"championship_country_id" uuid NOT NULL,
	"unit_index" integer NOT NULL,
	"time_seconds" numeric(6, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_scoring_units_index_check" CHECK ("run_scoring_units"."unit_index" >= 0),
	CONSTRAINT "run_scoring_units_time_check" CHECK ("run_scoring_units"."time_seconds" is null or "run_scoring_units"."time_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tie_break_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tie_break_round_id" uuid NOT NULL,
	"championship_rider_id" uuid,
	"championship_country_id" uuid,
	"time_seconds" numeric(6, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tie_break_entries_subject_check" CHECK (("tie_break_entries"."championship_rider_id" is not null) <> ("tie_break_entries"."championship_country_id" is not null)),
	CONSTRAINT "tie_break_entries_time_check" CHECK ("tie_break_entries"."time_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tie_break_entry_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tie_break_entry_id" uuid NOT NULL,
	"championship_rider_id" uuid NOT NULL,
	"points" numeric(4, 1) NOT NULL,
	CONSTRAINT "tie_break_entry_scores_points_check" CHECK ("tie_break_entry_scores"."points" in (0, 2, 4, 6))
);
--> statement-breakpoint
CREATE TABLE "tie_break_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"championship_id" uuid NOT NULL,
	"scope" "standings_scope" NOT NULL,
	"subject" "standings_subject" NOT NULL,
	"peg_size_cm" numeric(4, 1) NOT NULL,
	"time_limit_seconds" numeric(6, 2) NOT NULL,
	"max_points" numeric(5, 1) NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_templates" ADD CONSTRAINT "championship_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_days" ADD CONSTRAINT "template_days_template_id_championship_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."championship_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_events" ADD CONSTRAINT "template_events_template_day_id_template_days_id_fk" FOREIGN KEY ("template_day_id") REFERENCES "public"."template_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_template_event_id_template_events_id_fk" FOREIGN KEY ("template_event_id") REFERENCES "public"."template_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_countries" ADD CONSTRAINT "championship_countries_championship_id_championships_id_fk" FOREIGN KEY ("championship_id") REFERENCES "public"."championships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_countries" ADD CONSTRAINT "championship_countries_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_days" ADD CONSTRAINT "championship_days_championship_id_championships_id_fk" FOREIGN KEY ("championship_id") REFERENCES "public"."championships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_events" ADD CONSTRAINT "championship_events_championship_day_id_championship_days_id_fk" FOREIGN KEY ("championship_day_id") REFERENCES "public"."championship_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_riders" ADD CONSTRAINT "championship_riders_championship_country_id_championship_countries_id_fk" FOREIGN KEY ("championship_country_id") REFERENCES "public"."championship_countries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_riders" ADD CONSTRAINT "championship_riders_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_runs" ADD CONSTRAINT "championship_runs_championship_event_id_championship_events_id_fk" FOREIGN KEY ("championship_event_id") REFERENCES "public"."championship_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championship_runs" ADD CONSTRAINT "championship_runs_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championships" ADD CONSTRAINT "championships_source_template_id_championship_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."championship_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "championships" ADD CONSTRAINT "championships_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_entry_order_items" ADD CONSTRAINT "run_entry_order_items_run_entry_order_id_run_entry_orders_id_fk" FOREIGN KEY ("run_entry_order_id") REFERENCES "public"."run_entry_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_entry_order_items" ADD CONSTRAINT "run_entry_order_items_championship_rider_id_championship_riders_id_fk" FOREIGN KEY ("championship_rider_id") REFERENCES "public"."championship_riders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_entry_orders" ADD CONSTRAINT "run_entry_orders_run_id_championship_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."championship_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_entry_orders" ADD CONSTRAINT "run_entry_orders_championship_country_id_championship_countries_id_fk" FOREIGN KEY ("championship_country_id") REFERENCES "public"."championship_countries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_entry_orders" ADD CONSTRAINT "run_entry_orders_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_revisions" ADD CONSTRAINT "run_revisions_run_id_championship_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."championship_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_revisions" ADD CONSTRAINT "run_revisions_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_score_targets" ADD CONSTRAINT "run_score_targets_run_score_id_run_scores_id_fk" FOREIGN KEY ("run_score_id") REFERENCES "public"."run_scores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_scores" ADD CONSTRAINT "run_scores_run_id_championship_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."championship_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_scores" ADD CONSTRAINT "run_scores_run_scoring_unit_id_run_scoring_units_id_fk" FOREIGN KEY ("run_scoring_unit_id") REFERENCES "public"."run_scoring_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_scores" ADD CONSTRAINT "run_scores_championship_rider_id_championship_riders_id_fk" FOREIGN KEY ("championship_rider_id") REFERENCES "public"."championship_riders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_scoring_units" ADD CONSTRAINT "run_scoring_units_run_id_championship_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."championship_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_scoring_units" ADD CONSTRAINT "run_scoring_units_championship_country_id_championship_countries_id_fk" FOREIGN KEY ("championship_country_id") REFERENCES "public"."championship_countries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tie_break_entries" ADD CONSTRAINT "tie_break_entries_tie_break_round_id_tie_break_rounds_id_fk" FOREIGN KEY ("tie_break_round_id") REFERENCES "public"."tie_break_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tie_break_entries" ADD CONSTRAINT "tie_break_entries_championship_rider_id_championship_riders_id_fk" FOREIGN KEY ("championship_rider_id") REFERENCES "public"."championship_riders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tie_break_entries" ADD CONSTRAINT "tie_break_entries_championship_country_id_championship_countries_id_fk" FOREIGN KEY ("championship_country_id") REFERENCES "public"."championship_countries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tie_break_entry_scores" ADD CONSTRAINT "tie_break_entry_scores_tie_break_entry_id_tie_break_entries_id_fk" FOREIGN KEY ("tie_break_entry_id") REFERENCES "public"."tie_break_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tie_break_entry_scores" ADD CONSTRAINT "tie_break_entry_scores_championship_rider_id_championship_riders_id_fk" FOREIGN KEY ("championship_rider_id") REFERENCES "public"."championship_riders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tie_break_rounds" ADD CONSTRAINT "tie_break_rounds_championship_id_championships_id_fk" FOREIGN KEY ("championship_id") REFERENCES "public"."championships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tie_break_rounds" ADD CONSTRAINT "tie_break_rounds_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_championship_idx" ON "audit_logs" USING btree ("championship_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_permissions_user_idx" ON "user_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_idx" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "countries_iso2_idx" ON "countries" USING btree ("iso2");--> statement-breakpoint
CREATE UNIQUE INDEX "countries_iso3_idx" ON "countries" USING btree ("iso3");--> statement-breakpoint
CREATE INDEX "countries_name_en_idx" ON "countries" USING btree ("name_en");--> statement-breakpoint
CREATE INDEX "riders_country_idx" ON "riders" USING btree ("country_id");--> statement-breakpoint
CREATE UNIQUE INDEX "riders_country_name_idx" ON "riders" USING btree ("country_id",lower(btrim("full_name")));--> statement-breakpoint
CREATE UNIQUE INDEX "championship_templates_name_idx" ON "championship_templates" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "template_days_unique_idx" ON "template_days" USING btree ("template_id","day_number");--> statement-breakpoint
CREATE UNIQUE INDEX "template_events_order_idx" ON "template_events" USING btree ("template_day_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "template_events_type_idx" ON "template_events" USING btree ("template_day_id","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "template_runs_unique_idx" ON "template_runs" USING btree ("template_event_id","run_number");--> statement-breakpoint
CREATE INDEX "template_runs_event_idx" ON "template_runs" USING btree ("template_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "championship_countries_unique_idx" ON "championship_countries" USING btree ("championship_id","country_id");--> statement-breakpoint
CREATE INDEX "championship_countries_championship_idx" ON "championship_countries" USING btree ("championship_id");--> statement-breakpoint
CREATE UNIQUE INDEX "championship_days_unique_idx" ON "championship_days" USING btree ("championship_id","day_number");--> statement-breakpoint
CREATE UNIQUE INDEX "championship_events_order_idx" ON "championship_events" USING btree ("championship_day_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "championship_events_type_idx" ON "championship_events" USING btree ("championship_day_id","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "championship_riders_unique_idx" ON "championship_riders" USING btree ("championship_country_id","rider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "championship_riders_order_idx" ON "championship_riders" USING btree ("championship_country_id","initial_order") WHERE "championship_riders"."initial_order" is not null;--> statement-breakpoint
CREATE INDEX "championship_riders_country_idx" ON "championship_riders" USING btree ("championship_country_id");--> statement-breakpoint
CREATE UNIQUE INDEX "championship_runs_unique_idx" ON "championship_runs" USING btree ("championship_event_id","run_number");--> statement-breakpoint
CREATE INDEX "championship_runs_status_idx" ON "championship_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "championships_slug_idx" ON "championships" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "championships_start_date_idx" ON "championships" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "championships_published_idx" ON "championships" USING btree ("is_published","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "run_entry_order_items_position_idx" ON "run_entry_order_items" USING btree ("run_entry_order_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "run_entry_order_items_rider_idx" ON "run_entry_order_items" USING btree ("run_entry_order_id","championship_rider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_entry_orders_unique_idx" ON "run_entry_orders" USING btree ("run_id","championship_country_id");--> statement-breakpoint
CREATE INDEX "run_entry_orders_run_idx" ON "run_entry_orders" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_revisions_unique_idx" ON "run_revisions" USING btree ("run_id","revision_number");--> statement-breakpoint
CREATE INDEX "run_revisions_run_idx" ON "run_revisions" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_score_targets_unique_idx" ON "run_score_targets" USING btree ("run_score_id","target_index");--> statement-breakpoint
CREATE UNIQUE INDEX "run_scores_rider_idx" ON "run_scores" USING btree ("run_id","championship_rider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_scores_unit_position_idx" ON "run_scores" USING btree ("run_scoring_unit_id","position_in_unit");--> statement-breakpoint
CREATE INDEX "run_scores_run_idx" ON "run_scores" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_scoring_units_unique_idx" ON "run_scoring_units" USING btree ("run_id","championship_country_id","unit_index");--> statement-breakpoint
CREATE INDEX "run_scoring_units_run_idx" ON "run_scoring_units" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tie_break_entries_rider_idx" ON "tie_break_entries" USING btree ("tie_break_round_id","championship_rider_id") WHERE "tie_break_entries"."championship_rider_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tie_break_entries_country_idx" ON "tie_break_entries" USING btree ("tie_break_round_id","championship_country_id") WHERE "tie_break_entries"."championship_country_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tie_break_entry_scores_unique_idx" ON "tie_break_entry_scores" USING btree ("tie_break_entry_id","championship_rider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tie_break_rounds_unique_idx" ON "tie_break_rounds" USING btree ("championship_id","scope","subject");