CREATE TABLE "company_role_assignment_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"role_assignment_id" text NOT NULL,
	"block_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_role_assignment_blocks" ADD CONSTRAINT "company_role_assignment_blocks_role_assignment_id_company_role_assignments_id_fk" FOREIGN KEY ("role_assignment_id") REFERENCES "public"."company_role_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_role_assignment_blocks" ADD CONSTRAINT "company_role_assignment_blocks_block_id_project_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."project_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_role_assignment_blocks_unique_idx" ON "company_role_assignment_blocks" USING btree ("role_assignment_id","block_id");--> statement-breakpoint
CREATE INDEX "company_role_assignment_blocks_block_idx" ON "company_role_assignment_blocks" USING btree ("block_id");