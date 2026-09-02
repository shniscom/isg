ALTER TABLE "employees" ADD COLUMN "ek2_suitable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "ek2_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "health_authority_doctor_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "health_authority_certificate_no" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "isg_trainer_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "isg_trainer_certificate_no" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "temp_assignment_ending_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "training_expiry_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "medical_exam_expiry_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "ek2_expiry_reminder_sent_at" timestamp with time zone;