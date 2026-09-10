ALTER TABLE "companies" ADD COLUMN "is_temporary_assignment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "assignment_form_exists" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "sgk_entry_doc_exists" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "orientation_training_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "ppe_handover_doc_exists" boolean DEFAULT false NOT NULL;