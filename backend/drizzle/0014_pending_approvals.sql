CREATE TYPE "public"."approval_status" AS ENUM('BEKLEMEDE', 'ONAYLANDI', 'REDDEDILDI');--> statement-breakpoint
CREATE TABLE "pending_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"action_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"project_id" text,
	"status" "approval_status" DEFAULT 'BEKLEMEDE' NOT NULL,
	"requested_by_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"decision_note" text
);
--> statement-breakpoint
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_approvals_status_idx" ON "pending_approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pending_approvals_project_idx" ON "pending_approvals" USING btree ("project_id");