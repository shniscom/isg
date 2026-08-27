CREATE TYPE "public"."archive_status" AS ENUM('OLUSTURULDU', 'SILINDI');--> statement-breakpoint
CREATE TABLE "archives" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"period_label" text NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"status" "archive_status" DEFAULT 'OLUSTURULDU' NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by_id" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "archives" ADD CONSTRAINT "archives_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archives" ADD CONSTRAINT "archives_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archives" ADD CONSTRAINT "archives_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "archives_project_period_idx" ON "archives" USING btree ("project_id","period_label");