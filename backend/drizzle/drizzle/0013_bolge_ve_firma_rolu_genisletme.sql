CREATE TABLE "company_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"block_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_role_types" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"category" text DEFAULT 'FIRMA_ROLU' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_role_assignments" ALTER COLUMN "role_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "company_blocks" ADD CONSTRAINT "company_blocks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_blocks" ADD CONSTRAINT "company_blocks_block_id_project_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."project_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_blocks_unique_idx" ON "company_blocks" USING btree ("company_id","block_id");--> statement-breakpoint
CREATE INDEX "company_blocks_block_idx" ON "company_blocks" USING btree ("block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_role_types_key_idx" ON "company_role_types" USING btree ("key");--> statement-breakpoint
INSERT INTO "company_role_types" ("id", "key", "label", "category", "sort_order") VALUES
('c9a1a001-1111-4a11-8a11-000000000001', 'ISVEREN', 'İşveren', 'FIRMA_ROLU', 1),
('c9a1a001-1111-4a11-8a11-000000000002', 'ISVEREN_VEKILI', 'İşveren Vekili', 'FIRMA_ROLU', 2),
('c9a1a001-1111-4a11-8a11-000000000003', 'SANTIYE_SEFI', 'Şantiye Şefi', 'FIRMA_ROLU', 3),
('c9a1a001-1111-4a11-8a11-000000000004', 'CALISAN_TEMSILCISI', 'Çalışan Temsilcisi', 'FIRMA_ROLU', 4),
('c9a1a001-1111-4a11-8a11-000000000005', 'DESTEK_PERSONELI', 'Destek Personeli', 'FIRMA_ROLU', 5),
('c9a1a001-1111-4a11-8a11-000000000006', 'PROJE_MUDURU', 'Proje Müdürü', 'FIRMA_ROLU', 6),
('c9a1a001-1111-4a11-8a11-000000000007', 'ISG_UZMANI', 'İSG Uzmanı', 'FIRMA_ROLU', 7),
('c9a1a001-1111-4a11-8a11-000000000008', 'ISYERI_HEKIMI', 'İşyeri Hekimi', 'FIRMA_ROLU', 8),
('c9a1a001-1111-4a11-8a11-000000000009', 'DIGER_SAGLIK_PERSONELI', 'Diğer Sağlık Personeli', 'FIRMA_ROLU', 9),
('c9a1a001-1111-4a11-8a11-000000000010', 'ILKYARDIM', 'İlkyardımcı', 'ACIL_EKIP', 1),
('c9a1a001-1111-4a11-8a11-000000000011', 'ARAMA_KURTARMA', 'Arama-Kurtarma', 'ACIL_EKIP', 2),
('c9a1a001-1111-4a11-8a11-000000000012', 'KORUMA', 'Koruma', 'ACIL_EKIP', 3);
--> statement-breakpoint
ALTER TABLE "company_role_assignments" ADD CONSTRAINT "company_role_assignments_role_type_company_role_types_key_fk" FOREIGN KEY ("role_type") REFERENCES "public"."company_role_types"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."company_role_type";