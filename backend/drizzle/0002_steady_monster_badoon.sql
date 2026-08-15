DROP INDEX "user_projects_unique_idx";--> statement-breakpoint
ALTER TABLE "user_projects" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "user_projects" ADD CONSTRAINT "user_projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_projects_unique_idx" ON "user_projects" USING btree ("user_id","project_id","role_id","company_id");