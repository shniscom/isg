CREATE TYPE "public"."penalty_sanction" AS ENUM('PARA_CEZASI', 'UYARI', 'CALISMADAN_UZAKLASTIRMA', 'IS_AKDI_FESHI', 'DIGER');--> statement-breakpoint
CREATE TYPE "public"."penalty_status" AS ENUM('BEKLEMEDE', 'ONAYLANDI', 'REDDEDILDI');--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"company_id" text,
	"full_name" text NOT NULL,
	"national_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "penalties" (
	"id" text PRIMARY KEY NOT NULL,
	"nonconformity_id" text NOT NULL,
	"employee_id" text,
	"requested_by_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"sanction_type" "penalty_sanction" DEFAULT 'PARA_CEZASI' NOT NULL,
	"suggested_amount" integer,
	"status" "penalty_status" DEFAULT 'BEKLEMEDE' NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nonconformities" ADD COLUMN "employee_id" text;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD COLUMN "correction_suggestion" text;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD COLUMN "risk_score" integer;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD COLUMN "deadline_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_nonconformity_id_nonconformities_id_fk" FOREIGN KEY ("nonconformity_id") REFERENCES "public"."nonconformities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employees_project_idx" ON "employees" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "employees_company_idx" ON "employees" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "penalties_nonconformity_idx" ON "penalties" USING btree ("nonconformity_id");--> statement-breakpoint
CREATE INDEX "penalties_employee_idx" ON "penalties" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "penalties_status_idx" ON "penalties" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;