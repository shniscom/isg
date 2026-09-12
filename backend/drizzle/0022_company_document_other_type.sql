ALTER TYPE "public"."company_doc_type" ADD VALUE 'DIGER';--> statement-breakpoint
ALTER TABLE "company_documents" ADD COLUMN "doc_type_other" text;