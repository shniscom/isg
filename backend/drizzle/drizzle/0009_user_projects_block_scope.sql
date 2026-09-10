ALTER TABLE "user_projects" ADD COLUMN "block_id" text;
--> statement-breakpoint
ALTER TABLE "user_projects" ADD CONSTRAINT "user_projects_block_id_project_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."project_blocks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DROP INDEX "user_projects_unique_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "user_projects_unique_idx" ON "user_projects" USING btree ("user_id","project_id","role_id","company_id","block_id");
