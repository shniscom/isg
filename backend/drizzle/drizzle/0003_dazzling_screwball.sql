CREATE TABLE "nonconformity_assignees" (
	"id" text PRIMARY KEY NOT NULL,
	"nonconformity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"nonconformity_id" text,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nonconformities" DROP CONSTRAINT "nonconformities_assigned_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "nonconformities_assigned_idx";--> statement-breakpoint
ALTER TABLE "nonconformity_assignees" ADD CONSTRAINT "nonconformity_assignees_nonconformity_id_nonconformities_id_fk" FOREIGN KEY ("nonconformity_id") REFERENCES "public"."nonconformities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformity_assignees" ADD CONSTRAINT "nonconformity_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_nonconformity_id_nonconformities_id_fk" FOREIGN KEY ("nonconformity_id") REFERENCES "public"."nonconformities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nonconformity_assignees_unique_idx" ON "nonconformity_assignees" USING btree ("nonconformity_id","user_id");--> statement-breakpoint
CREATE INDEX "nonconformity_assignees_user_idx" ON "nonconformity_assignees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
-- Mevcut tekli atamaları yeni çoklu-atanan tablosuna aktar (veri kaybını önlemek için).
INSERT INTO "nonconformity_assignees" ("id", "nonconformity_id", "user_id")
SELECT gen_random_uuid()::text, "id", "assigned_user_id" FROM "nonconformities"
WHERE "assigned_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "nonconformities" DROP COLUMN "assigned_user_id";