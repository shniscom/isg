-- Mevcut serbest metin İSG uzmanı / işyeri hekimi bilgilerini (isg_trainer_name/certificate_no,
-- health_authority_doctor_name/certificate_no) company_role_assignments kayıtlarına taşır, yeni
-- employees.isg_specialist_assignment_id / physician_assignment_id alanlarına bağlar, sonra eski
-- serbest metin sütunlarını kaldırır. Bkz. schema.js employees tablosu yorumu.
DO $$
DECLARE
  fallback_user_id text;
BEGIN
  SELECT id INTO fallback_user_id FROM users WHERE is_system_admin = true ORDER BY created_at ASC LIMIT 1;
  IF fallback_user_id IS NULL THEN
    SELECT id INTO fallback_user_id FROM users ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF fallback_user_id IS NOT NULL THEN
    WITH source AS (
      SELECT DISTINCT company_id, isg_trainer_name, isg_trainer_certificate_no
      FROM employees
      WHERE company_id IS NOT NULL AND isg_trainer_name IS NOT NULL AND btrim(isg_trainer_name) <> ''
    ),
    inserted AS (
      INSERT INTO company_role_assignments (id, company_id, role_type, source, outside_full_name, certificate_no, created_by_id, notes, created_at)
      SELECT gen_random_uuid()::text, company_id, 'ISG_UZMANI', 'DISARIDAN', isg_trainer_name, NULLIF(btrim(isg_trainer_certificate_no), ''), fallback_user_id, 'Otomatik aktarım (v29 - eski serbest metin alanından)', now()
      FROM source
      RETURNING id, company_id, outside_full_name, certificate_no
    )
    UPDATE employees e
    SET isg_specialist_assignment_id = i.id
    FROM inserted i
    WHERE e.company_id = i.company_id
      AND e.isg_trainer_name = i.outside_full_name
      AND (NULLIF(btrim(e.isg_trainer_certificate_no), '') IS NOT DISTINCT FROM i.certificate_no);

    WITH source AS (
      SELECT DISTINCT company_id, health_authority_doctor_name, health_authority_certificate_no
      FROM employees
      WHERE company_id IS NOT NULL AND health_authority_doctor_name IS NOT NULL AND btrim(health_authority_doctor_name) <> ''
    ),
    inserted AS (
      INSERT INTO company_role_assignments (id, company_id, role_type, source, outside_full_name, certificate_no, created_by_id, notes, created_at)
      SELECT gen_random_uuid()::text, company_id, 'ISYERI_HEKIMI', 'DISARIDAN', health_authority_doctor_name, NULLIF(btrim(health_authority_certificate_no), ''), fallback_user_id, 'Otomatik aktarım (v29 - eski serbest metin alanından)', now()
      FROM source
      RETURNING id, company_id, outside_full_name, certificate_no
    )
    UPDATE employees e
    SET physician_assignment_id = i.id
    FROM inserted i
    WHERE e.company_id = i.company_id
      AND e.health_authority_doctor_name = i.outside_full_name
      AND (NULLIF(btrim(e.health_authority_certificate_no), '') IS NOT DISTINCT FROM i.certificate_no);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "health_authority_doctor_name";--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "health_authority_certificate_no";--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "isg_trainer_name";--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "isg_trainer_certificate_no";
