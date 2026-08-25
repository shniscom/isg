CREATE TYPE "public"."extension_status" AS ENUM('BEKLEMEDE', 'ONAYLANDI', 'REDDEDILDI');--> statement-breakpoint
CREATE TABLE "due_date_extensions" (
	"id" text PRIMARY KEY NOT NULL,
	"nonconformity_id" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_due_date" timestamp with time zone NOT NULL,
	"requested_new_due_date" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"status" "extension_status" DEFAULT 'BEKLEMEDE' NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nonconformities" ADD COLUMN "deadline_expired_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "due_date_extensions" ADD CONSTRAINT "due_date_extensions_nonconformity_id_nonconformities_id_fk" FOREIGN KEY ("nonconformity_id") REFERENCES "public"."nonconformities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_date_extensions" ADD CONSTRAINT "due_date_extensions_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_date_extensions" ADD CONSTRAINT "due_date_extensions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "due_date_extensions_nonconformity_idx" ON "due_date_extensions" USING btree ("nonconformity_id");--> statement-breakpoint
CREATE INDEX "due_date_extensions_status_idx" ON "due_date_extensions" USING btree ("status");