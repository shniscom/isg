CREATE TYPE "public"."company_role_type" AS ENUM('ISVEREN', 'ISVEREN_VEKILI', 'SANTIYE_SEFI', 'CALISAN_TEMSILCISI', 'DESTEK_PERSONELI', 'PROJE_MUDURU', 'ISG_UZMANI', 'ISYERI_HEKIMI', 'DIGER_SAGLIK_PERSONELI', 'ILKYARDIM', 'ARAMA_KURTARMA', 'KORUMA');--> statement-breakpoint
CREATE TYPE "public"."company_role_source" AS ENUM('CALISAN', 'DISARIDAN');--> statement-breakpoint
CREATE TYPE "public"."incident_type" AS ENUM('KAZA', 'RAMAK_KALA');--> statement-breakpoint
CREATE TYPE "public"."company_doc_type" AS ENUM('RISK_ANALIZI', 'ACIL_DURUM_EYLEM_PLANI');--> statement-breakpoint
CREATE TYPE "public"."danger_class" AS ENUM('COK_TEHLIKELI', 'TEHLIKELI', 'AZ_TEHLIKELI');--> statement-breakpoint
CREATE TYPE "public"."equipment_assigned_to" AS ENUM('FIRMA', 'KISI');--> statement-breakpoint
CREATE TYPE "public"."equipment_operator_source" AS ENUM('CALISAN', 'DISARIDAN', 'YOK');--> statement-breakpoint
CREATE TABLE "company_role_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"role_type" "company_role_type" NOT NULL,
	"source" "company_role_source" DEFAULT 'CALISAN' NOT NULL,
	"employee_id" text,
	"outside_full_name" text,
	"outside_company_name" text,
	"outside_national_id" text,
	"outside_phone" text,
	"certificate_no" text,
	"certificate_class" text,
	"certificate_start_date" timestamp with time zone,
	"certificate_end_date" timestamp with time zone,
	"notes" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"type" "incident_type" NOT NULL,
	"event_date_time" timestamp with time zone NOT NULL,
	"employee_id" text,
	"event_description" text NOT NULL,
	"location" text,
	"cause" text,
	"witness_employee_id" text,
	"witness_statement" text,
	"referred_to_hospital" boolean DEFAULT false NOT NULL,
	"hospital_name" text,
	"first_aid_given" boolean DEFAULT false NOT NULL,
	"first_aid_given_by" text,
	"victim_profession" text,
	"doctor_report_photo_key" text,
	"report_days_off" integer,
	"return_to_work_date" timestamp with time zone,
	"actions_taken" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"doc_type" "company_doc_type" NOT NULL,
	"prepared_date" timestamp with time zone,
	"approved" boolean DEFAULT false NOT NULL,
	"approved_date" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"file_object_key" text,
	"notes" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"meeting_date" timestamp with time zone NOT NULL,
	"period_label" text NOT NULL,
	"is_extraordinary" boolean DEFAULT false NOT NULL,
	"attendance_form_file_key" text,
	"notes" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"serial_number" text,
	"license_number" text,
	"periodic_inspection_date" timestamp with time zone,
	"periodic_inspection_valid_until" timestamp with time zone,
	"has_damage" boolean DEFAULT false NOT NULL,
	"damage_description" text,
	"fit_for_use" boolean DEFAULT true NOT NULL,
	"assigned_to" "equipment_assigned_to" DEFAULT 'FIRMA' NOT NULL,
	"assigned_employee_id" text,
	"operator_source" "equipment_operator_source" DEFAULT 'YOK' NOT NULL,
	"operator_employee_id" text,
	"operator_outside_full_name" text,
	"operator_outside_company_name" text,
	"operator_outside_national_id" text,
	"operator_outside_sgk_no" text,
	"operator_certificate_no" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "requires_board" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "danger_class" "danger_class";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "myk_certificate_no" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "myk_certificate_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_role_assignments" ADD CONSTRAINT "company_role_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_role_assignments" ADD CONSTRAINT "company_role_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_role_assignments" ADD CONSTRAINT "company_role_assignments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_witness_employee_id_employees_id_fk" FOREIGN KEY ("witness_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_meetings" ADD CONSTRAINT "board_meetings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_meetings" ADD CONSTRAINT "board_meetings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_assigned_employee_id_employees_id_fk" FOREIGN KEY ("assigned_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_operator_employee_id_employees_id_fk" FOREIGN KEY ("operator_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_role_assignments_company_idx" ON "company_role_assignments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_role_assignments_employee_idx" ON "company_role_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "incidents_company_idx" ON "incidents" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "company_documents_company_idx" ON "company_documents" USING btree ("company_id","doc_type");--> statement-breakpoint
CREATE INDEX "board_meetings_company_period_idx" ON "board_meetings" USING btree ("company_id","period_label");--> statement-breakpoint
CREATE INDEX "equipment_project_company_idx" ON "equipment" USING btree ("project_id","company_id");