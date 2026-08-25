ALTER TABLE "employees" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "isg_training_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "medical_exam_note" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "end_date" timestamp with time zone;