ALTER TABLE "employees" ADD COLUMN "first_start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "last_exit_date" timestamp with time zone;--> statement-breakpoint
-- Mevcut çalışan kayıtları için geriye dönük doldurma: ilk giriş tarihi bilinmiyorsa mevcut
-- giriş tarihini "ilk giriş" olarak kabul ederiz; en son çıkış tarihi bilinmiyorsa (henüz hiç
-- arşivlenmemiş ya da tarihsiz arşivlenmiş) mevcut çıkış tarihini kopyalarız (null ise null kalır).
UPDATE "employees" SET "first_start_date" = "start_date" WHERE "first_start_date" IS NULL;--> statement-breakpoint
UPDATE "employees" SET "last_exit_date" = "end_date" WHERE "last_exit_date" IS NULL AND "end_date" IS NOT NULL;
