ALTER TABLE "users" ADD COLUMN "theme_key" text DEFAULT 'klasik' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "color_mode" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "button_density" text DEFAULT 'compact' NOT NULL;