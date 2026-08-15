CREATE TYPE "public"."nonconformity_status" AS ENUM('ACIK', 'BEKLEMEDE', 'KAPALI', 'TERMIN_ASIMI', 'ITIRAZ');--> statement-breakpoint
CREATE TYPE "public"."nonconformity_priority" AS ENUM('DUSUK', 'ORTA', 'YUKSEK', 'KRITIK');--> statement-breakpoint
CREATE TYPE "public"."nonconformity_photo_type" AS ENUM('ACILIS', 'DUZELTME', 'ITIRAZ', 'CEZA', 'DIGER');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('BEKLEMEDE', 'ONAYLANDI', 'REDDEDILDI');--> statement-breakpoint
CREATE TABLE "nonconformities" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"project_id" text NOT NULL,
	"category_id" text,
	"block_id" text,
	"company_id" text,
	"opened_by_id" text NOT NULL,
	"assigned_user_id" text NOT NULL,
	"description" text NOT NULL,
	"priority" "nonconformity_priority" DEFAULT 'ORTA' NOT NULL,
	"status" "nonconformity_status" DEFAULT 'ACIK' NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nonconformity_corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"nonconformity_id" text NOT NULL,
	"description" text NOT NULL,
	"submitted_by_id" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "correction_status" DEFAULT 'BEKLEMEDE' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text
);
--> statement-breakpoint
CREATE TABLE "nonconformity_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"nonconformity_id" text NOT NULL,
	"correction_id" text,
	"type" "nonconformity_photo_type" DEFAULT 'DIGER' NOT NULL,
	"object_key" text NOT NULL,
	"original_file_name" text,
	"uploaded_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nonconformity_status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"nonconformity_id" text NOT NULL,
	"from_status" "nonconformity_status",
	"to_status" "nonconformity_status" NOT NULL,
	"actor_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "nonconformity_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_block_id_project_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."project_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_opened_by_id_users_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformity_corrections" ADD CONSTRAINT "nonconformity_corrections_nonconformity_id_nonconformities_id_fk" FOREIGN KEY ("nonconformity_id") REFERENCES "public"."nonconformities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformity_corrections" ADD CONSTRAINT "nonconformity_corrections_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformity_corrections" ADD CONSTRAINT "nonconformity_corrections_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformity_photos" ADD CONSTRAINT "nonconformity_photos_nonconformity_id_nonconformities_id_fk" FOREIGN KEY ("nonconformity_id") REFERENCES "public"."nonconformities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformity_photos" ADD CONSTRAINT "nonconformity_photos_correction_id_nonconformity_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."nonconformity_corrections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformity_photos" ADD CONSTRAINT "nonconformity_photos_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformity_status_history" ADD CONSTRAINT "nonconformity_status_history_nonconformity_id_nonconformities_id_fk" FOREIGN KEY ("nonconformity_id") REFERENCES "public"."nonconformities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformity_status_history" ADD CONSTRAINT "nonconformity_status_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nonconformities_number_idx" ON "nonconformities" USING btree ("number");--> statement-breakpoint
CREATE INDEX "nonconformities_project_status_idx" ON "nonconformities" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "nonconformities_assigned_idx" ON "nonconformities" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "nonconformity_corrections_nc_idx" ON "nonconformity_corrections" USING btree ("nonconformity_id");--> statement-breakpoint
CREATE INDEX "nonconformity_photos_nc_idx" ON "nonconformity_photos" USING btree ("nonconformity_id");--> statement-breakpoint
CREATE INDEX "nonconformity_status_history_nc_idx" ON "nonconformity_status_history" USING btree ("nonconformity_id");