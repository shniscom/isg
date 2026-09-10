ALTER TABLE "incidents" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "first_aid_given_by_id" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "first_aid_given_by_outside_national_id" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "first_aid_given_by_outside_phone" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "first_aid_given_by_outside_company_name" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "return_to_work_training_given" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "return_to_work_training_topic" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "return_to_work_training_duration" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "return_to_work_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_first_aid_given_by_id_company_role_assignments_id_fk" FOREIGN KEY ("first_aid_given_by_id") REFERENCES "public"."company_role_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Mevcut kayıtlara geriye dönük kod üret: FIRMA(ilk3harf)-KZ|RK-YIL-SIRA (firma+tür+yıl bazında,
-- olay tarihine göre kronolojik sıra). Yeni kayıtlar için kod backend'de (generateIncidentCode)
-- aynı mantıkla üretilir.
WITH ranked AS (
  SELECT i.id,
         c.name AS company_name,
         i.type,
         extract(year from i.event_date_time)::int AS yr,
         row_number() OVER (
           PARTITION BY i.company_id, i.type, extract(year from i.event_date_time)
           ORDER BY i.event_date_time ASC, i.created_at ASC, i.id ASC
         ) AS seq
  FROM incidents i
  JOIN companies c ON c.id = i.company_id
)
UPDATE incidents i
SET code = upper(left(regexp_replace(r.company_name, '[^A-Za-zÇĞİÖŞÜçğıöşü0-9]', '', 'g'), 3)) || '-' ||
           (CASE WHEN r.type = 'KAZA' THEN 'KZ' ELSE 'RK' END) || '-' || r.yr || '-' || lpad(r.seq::text, 3, '0')
FROM ranked r
WHERE r.id = i.id;
--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_code_idx" ON "incidents" USING btree ("code");