ALTER TABLE "employees" DROP COLUMN "isg_training_completed";
--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "medical_exam_note";
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "isg_training_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "isg_training_expiry_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "medical_exam_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "start_work_training_note" text;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "ek2_note" text;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "health_authority_signature_note" text;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "isg_role" text;
