ALTER TABLE "employees" ADD COLUMN "isg_specialist_assignment_id" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "physician_assignment_id" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "dsp_assignment_id" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "medical_exam_types" jsonb;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_isg_specialist_assignment_id_company_role_assignments_id_fk" FOREIGN KEY ("isg_specialist_assignment_id") REFERENCES "public"."company_role_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_physician_assignment_id_company_role_assignments_id_fk" FOREIGN KEY ("physician_assignment_id") REFERENCES "public"."company_role_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_dsp_assignment_id_company_role_assignments_id_fk" FOREIGN KEY ("dsp_assignment_id") REFERENCES "public"."company_role_assignments"("id") ON DELETE set null ON UPDATE no action;