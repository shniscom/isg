// Yerel Uygunsuzluk ve İSG Takip Sistemi - Drizzle ORM şeması
// FAZ 1: Kullanıcı, Proje, Firma, Rol/Yetki sistemi
// FAZ 2+3: Uygunsuzluk açma/atama/listeleme, fotoğraf, düzeltme, onay/red, tarihçe
// Not: Bildirim, termin aşımı otomasyonu, itiraz, ceza sistemleri FAZ 4+ aşamalarında eklenecektir.
// (Şemadaki ilgili enum değerleri ileride kullanılmak üzere şimdiden ayrılmıştır.)

const { pgTable, text, boolean, integer, timestamp, jsonb, pgEnum, uniqueIndex, index } = require('drizzle-orm/pg-core');
const { relations } = require('drizzle-orm');
const crypto = require('crypto');

const genId = () => crypto.randomUUID();

const companyTypeEnum = pgEnum('company_type', [
  'ANA_FIRMA',
  'ALT_ISVEREN',
  'TASERON',
  'UCUNCU_SAHIS_HIZMET_VEREN',
  'TEDARIKCI',
  'DIGER',
]);

const projectStatusEnum = pgEnum('project_status', ['AKTIF', 'PASIF']);

// Kritik/geri dönülmez işlemler için admin onay kuyruğu durumu. bkz. pendingApprovals tablosu.
const approvalStatusEnum = pgEnum('approval_status', ['BEKLEMEDE', 'ONAYLANDI', 'REDDEDILDI']);

// Uygunsuzluk durum makinesi. FAZ2+3'te yalnızca ACIK <-> BEKLEMEDE -> KAPALI arası geçişler
// desteklenir. TERMIN_ASIMI (FAZ4) ve ITIRAZ (FAZ5) değerleri şema kararlılığı için şimdiden
// tanımlanmıştır ama henüz hiçbir işlem bu durumlara otomatik geçiş yapmaz.
const nonconformityStatusEnum = pgEnum('nonconformity_status', [
  'ACIK',
  'BEKLEMEDE',
  'KAPALI',
  'TERMIN_ASIMI',
  'ITIRAZ',
]);

const nonconformityPriorityEnum = pgEnum('nonconformity_priority', ['DUSUK', 'ORTA', 'YUKSEK', 'KRITIK']);

const nonconformityPhotoTypeEnum = pgEnum('nonconformity_photo_type', [
  'ACILIS',
  'DUZELTME',
  'ITIRAZ',
  'CEZA',
  'DIGER',
]);

const correctionStatusEnum = pgEnum('correction_status', ['BEKLEMEDE', 'ONAYLANDI', 'REDDEDILDI']);
const penaltySanctionEnum = pgEnum('penalty_sanction', ['PARA_CEZASI', 'UYARI', 'CALISMADAN_UZAKLASTIRMA', 'IS_AKDI_FESHI', 'DIGER']);
const penaltyStatusEnum = pgEnum('penalty_status', ['BEKLEMEDE', 'ONAYLANDI', 'REDDEDILDI']);
const extensionStatusEnum = pgEnum('extension_status', ['BEKLEMEDE', 'ONAYLANDI', 'REDDEDILDI']);
const archiveStatusEnum = pgEnum('archive_status', ['OLUSTURULDU', 'SILINDI']);
// NOT: Firma rolü tipleri (İşveren, Şantiye Şefi, İSG Uzmanı vb.) eskiden sabit bir Postgres
// enum'uydu (company_role_type). Artık admin tarafından "Görevler" sayfasından yönetilebilen
// dinamik bir tablo (company_role_types) haline getirildi; bkz. aşağıdaki companyRoleTypes.
const companyRoleSourceEnum = pgEnum('company_role_source', ['CALISAN', 'DISARIDAN']);
const incidentTypeEnum = pgEnum('incident_type', ['KAZA', 'RAMAK_KALA']);
const companyDocTypeEnum = pgEnum('company_doc_type', ['RISK_ANALIZI', 'ACIL_DURUM_EYLEM_PLANI']);
const dangerClassEnum = pgEnum('danger_class', ['COK_TEHLIKELI', 'TEHLIKELI', 'AZ_TEHLIKELI']);
const equipmentAssignedToEnum = pgEnum('equipment_assigned_to', ['FIRMA', 'KISI']);
const equipmentOperatorSourceEnum = pgEnum('equipment_operator_source', ['CALISAN', 'DISARIDAN', 'YOK']);

const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(genId),
  fullName: text('full_name').notNull(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  phone: text('phone'),
  email: text('email'),
  isSystemAdmin: boolean('is_system_admin').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  // Bu sistem kullanıcısının sahadaki hangi çalışan (employees) kaydına karşılık geldiği - opsiyonel.
  // "Kullanıcılar yalnızca firma çalışanları arasından seçilebilmeli" kuralı için: yeni kullanıcı
  // eklerken bir çalışan seçilirse buraya bağlanır. Boşsa "roster dışı" bir kullanıcı demektir
  // (bkz. admin/users.routes.js USER_CREATE_OFF_ROSTER - böyle bir ekleme admin onayı gerektirir).
  // Bir çalışan yalnızca bir kullanıcıya bağlanabilir (unique).
  employeeId: text('employee_id').references(() => employees.id, { onDelete: 'set null' }),
  // Görünüm tercihleri: her kullanıcı kendi hesabında saklanır, cihaz değiştirince de korunur.
  // themeKey -> frontend'deki tema kataloğundaki bir anahtar (ör. 'klasik', 'kirmizi'); geçersiz/
  // eski bir anahtar gelirse frontend varsayılana düşer, bu yüzden burada enum kullanılmadı.
  themeKey: text('theme_key').notNull().default('klasik'),
  colorMode: text('color_mode').notNull().default('system'), // 'light' | 'dark' | 'system'
  buttonDensity: text('button_density').notNull().default('compact'), // 'compact' | 'comfortable'
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_username_idx').on(table.username),
  uniqueIndex('users_employee_id_idx').on(table.employeeId),
]);

const projects = pgTable('projects', {
  id: text('id').primaryKey().$defaultFn(genId),
  name: text('name').notNull(),
  code: text('code').notNull(),
  address: text('address'),
  startDate: timestamp('start_date', { withTimezone: true }),
  plannedEndDate: timestamp('planned_end_date', { withTimezone: true }),
  employer: text('employer'),
  status: projectStatusEnum('status').notNull().default('AKTIF'),
  // Uygunsuzluk numaralarının proje bazında atomik olarak üretilmesi için sayaç (örn. 2026-ANK-000125).
  nonconformitySeq: integer('nonconformity_seq').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('projects_code_idx').on(table.code),
]);

const projectBlocks = pgTable('project_blocks', {
  id: text('id').primaryKey().$defaultFn(genId),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('project_blocks_project_name_idx').on(table.projectId, table.name),
]);

const companies = pgTable('companies', {
  id: text('id').primaryKey().$defaultFn(genId),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  taxNumber: text('tax_number'),
  sgkNumber: text('sgk_number'),
  type: companyTypeEnum('type').notNull().default('DIGER'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  scopeOfWork: text('scope_of_work'),
  responsibleBlockId: text('responsible_block_id').references(() => projectBlocks.id, { onDelete: 'set null' }),
  // İSG kurulu kurulması gerekiyor mu ve tehlike sınıfı nedir (kurul periyodu bu sınıfa göre hesaplanır).
  requiresBoard: boolean('requires_board').notNull().default(false),
  dangerClass: dangerClassEnum('danger_class'),
  isActive: boolean('is_active').notNull().default(true),
  // Geçici görevlendirme firması mı (sahaya kısa süreliğine görevle giren firma çalışanları için).
  // true ise bu firma "Geçici Görevlendirme" sekmelerinde listelenir ve firma/çalışan
  // oluşturma-düzenleme işlemleri (admin dışındaki kullanıcılar için) admin onayına tabidir.
  isTemporaryAssignment: boolean('is_temporary_assignment').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const companyUsers = pgTable('company_users', {
  id: text('id').primaryKey().$defaultFn(genId),
  companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('company_users_company_user_idx').on(table.companyId, table.userId),
]);

/**
 * Bir firmanın hangi bölge(ler)den/blok(lar)dan sorumlu olduğunu belirtir (çoktan çoğa).
 * Örn. "A Firması" hem "A Bölgesi" hem "B Bölgesi"nden sorumlu olabilir. Bir firmanın hiç
 * satırı yoksa (boş) projenin tamamından sorumlu kabul edilir - "Tüm Bölgeler" anlamına gelir.
 * Eski tekil companies.responsibleBlockId alanı artık kullanılmıyor (geriye dönük uyumluluk
 * için silinmedi), tüm yeni kod bu tabloyu kullanır.
 */
const companyBlocks = pgTable('company_blocks', {
  id: text('id').primaryKey().$defaultFn(genId),
  companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  blockId: text('block_id').notNull().references(() => projectBlocks.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('company_blocks_unique_idx').on(table.companyId, table.blockId),
  index('company_blocks_block_idx').on(table.blockId),
]);

const roles = pgTable('roles', {
  id: text('id').primaryKey().$defaultFn(genId),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('roles_name_idx').on(table.name),
]);

const permissions = pgTable('permissions', {
  id: text('id').primaryKey().$defaultFn(genId),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('permissions_key_idx').on(table.key),
]);

const userProjects = pgTable('user_projects', {
  id: text('id').primaryKey().$defaultFn(genId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => roles.id),
  // Boş ise atama projenin tamamını kapsar (ör. Ana Firma / Genel). Doluysa atama yalnızca
  // o firmaya özeldir (ör. "B taşeronunun İSG uzmanı"). Aynı kullanıcı aynı projede farklı
  // firma + görev kombinasyonlarına sahip olabilir.
  companyId: text('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  // Boş ise atama tüm bölgeleri kapsar. Doluysa atama yalnızca o bölgeye/bloğa özeldir
  // (ör. "5. parselin İSG uzmanı"). Firma ile birlikte veya bağımsız kullanılabilir.
  blockId: text('block_id').references(() => projectBlocks.id, { onDelete: 'cascade' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('user_projects_unique_idx').on(table.userId, table.projectId, table.roleId, table.companyId, table.blockId),
]);

const userPermissions = pgTable('user_permissions', {
  id: text('id').primaryKey().$defaultFn(genId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  permissionId: text('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  granted: boolean('granted').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const categories = pgTable('categories', {
  id: text('id').primaryKey().$defaultFn(genId),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey().$defaultFn(genId),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  details: jsonb('details'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('audit_logs_entity_idx').on(table.entityType, table.entityId),
  index('audit_logs_user_idx').on(table.userId),
]);

/**
 * Bir uygunsuzluk kaydı. Doküman terminolojisiyle: açan kişi, sorumlu firma, atanan kişi,
 * açıldığı blok/bölge, kategori, termin tarihi, öncelik ve durum bilgilerini taşır.
 */
/**
 * Sahada isim/T.C. kimlik no ile takip edilen çalışan kaydı. Uygunsuz davranışta bulunan
 * çalışanları uygunsuzluklara bağlamak ve tekrar eden ihlalleri görebilmek için kullanılır.
 * Sistem kullanıcısı (users) DEĞİLDİR; giriş yapamaz, yalnızca bir takip kaydıdır.
 */
const employees = pgTable('employees', {
  id: text('id').primaryKey().$defaultFn(genId),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  companyId: text('company_id').references(() => companies.id, { onDelete: 'set null' }),
  fullName: text('full_name').notNull(),
  nationalId: text('national_id'), // T.C. kimlik no
  position: text('position'), // SGK görev / iş kolu
  isgTrainingDate: timestamp('isg_training_date', { withTimezone: true }), // İSG eğitimi aldığı tarih
  isgTrainingExpiryDate: timestamp('isg_training_expiry_date', { withTimezone: true }), // İSG eğitimi geçerlilik (bitiş) tarihi
  medicalExamDate: timestamp('medical_exam_date', { withTimezone: true }), // tetkik tarihi
  startWorkTrainingNote: text('start_work_training_note'), // işe başlama eğitimi notu
  ek2Note: text('ek2_note'), // EK-2 formu notu/tarihi (serbest metin, eski/genel amaçlı alan)
  // EK-2 (periyodik sağlık muayenesi) yapılandırılmış alanları - serbest metin ek2Note'un yanında,
  // süre takibi/bildirim hesaplaması yapılabilsin diye ayrı boolean+tarih olarak tutulur.
  ek2Suitable: boolean('ek2_suitable').notNull().default(false), // Ek-2 formuna göre işe uygun mu
  ek2Date: timestamp('ek2_date', { withTimezone: true }), // Ek-2 formunun düzenlendiği tarih
  healthAuthoritySignatureNote: text('health_authority_signature_note'), // sağlık yetkilisi imza notu (eski/genel amaçlı alan)
  healthAuthorityDoctorName: text('health_authority_doctor_name'), // işyeri hekimi ad soyad
  healthAuthorityCertificateNo: text('health_authority_certificate_no'), // işyeri hekimi sertifika no
  isgRole: text('isg_role'), // İSG görevi (ör. Çalışan Temsilcisi)
  isgTrainerName: text('isg_trainer_name'), // İSG eğitimini veren iş güvenliği uzmanı ad soyad
  isgTrainerCertificateNo: text('isg_trainer_certificate_no'), // İSG eğitimini veren uzmanın sertifika no
  mykCertificateNo: text('myk_certificate_no'), // MYK mesleki yeterlilik belge no
  mykCertificateDate: timestamp('myk_certificate_date', { withTimezone: true }), // MYK belgesinin alındığı tarih
  startDate: timestamp('start_date', { withTimezone: true }), // işe giriş tarihi (yeniden işe girişte bu alan güncellenir - "yeniden giriş tarihi")
  endDate: timestamp('end_date', { withTimezone: true }), // işten çıkış tarihi (doluysa arşivde sayılır)
  isActive: boolean('is_active').notNull().default(true),
  // İlk giriş/çıkış geçmişi (bkz. "Kullanım Kılavuzu" > Çalışanlar > Yeniden İşe Alım):
  // firstStartDate bir çalışan kaydı ilk oluşturulduğunda bir kere set edilir, sonrasında asla
  // değişmez ("ilk giriş tarihi"). lastExitDate ise her arşivlenme (isActive true->false) anında
  // endDate ile birlikte güncellenir ve - endDate reaktivasyonda temizlense (null'a dönse) bile -
  // kalıcı olarak saklanır, böylece bir çalışan yeniden işe alındığında ("yeniden giriş") kartında
  // hem ilk giriş hem en son çıkış hem de yeni giriş tarihi birlikte gösterilebilir.
  firstStartDate: timestamp('first_start_date', { withTimezone: true }),
  lastExitDate: timestamp('last_exit_date', { withTimezone: true }),
  // Geçici görevlendirme alanları (yalnızca companies.isTemporaryAssignment=true olan firmaların
  // çalışanları için doldurulur; 6331 sayılı İSG Kanunu ve 5510 sayılı Kanun kapsamında sahaya
  // geçici görevle giren personelin dosyasında bulunması gereken belgeler). Görevlendirme
  // başlangıç/bitiş tarihleri için mevcut startDate/endDate alanları kullanılır (aynı çalışan
  // arşivleme mantığına tabi olsun diye); İSG eğitim sertifika tarihi/geçerliliği için mevcut
  // isgTrainingDate/isgTrainingExpiryDate alanları kullanılır.
  assignmentFormExists: boolean('assignment_form_exists').notNull().default(false), // görevlendirme yazısı/formu var mı
  sgkEntryDocExists: boolean('sgk_entry_doc_exists').notNull().default(false), // SGK işe giriş bildirgesi var mı
  orientationTrainingDate: timestamp('orientation_training_date', { withTimezone: true }), // yeni sahada verilen oryantasyon eğitimi tarihi
  ppeHandoverDocExists: boolean('ppe_handover_doc_exists').notNull().default(false), // KKD zimmet tutanağı yeni sahaya aktarıldı mı
  // Bildirim tekrarını önlemek için "bu bildirim daha önce gönderildi mi" işaretleri (bkz.
  // services/scheduledJobs.service.js - nonconformities.deadlineReminderSentAt ile aynı desen).
  tempAssignmentEndingReminderSentAt: timestamp('temp_assignment_ending_reminder_sent_at', { withTimezone: true }), // "görev bitiyor" (5 gün kala) bildirimi
  trainingExpiryReminderSentAt: timestamp('training_expiry_reminder_sent_at', { withTimezone: true }), // İSG eğitim geçerlilik süresi bildirimi
  medicalExamExpiryReminderSentAt: timestamp('medical_exam_expiry_reminder_sent_at', { withTimezone: true }), // tetkik süresi bildirimi
  ek2ExpiryReminderSentAt: timestamp('ek2_expiry_reminder_sent_at', { withTimezone: true }), // Ek-2 süresi bildirimi
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('employees_project_idx').on(table.projectId),
  index('employees_company_idx').on(table.companyId),
]);

const nonconformities = pgTable('nonconformities', {
  id: text('id').primaryKey().$defaultFn(genId),
  number: text('number').notNull(), // örn. 2026-ANK-000125
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  blockId: text('block_id').references(() => projectBlocks.id, { onDelete: 'set null' }),
  companyId: text('company_id').references(() => companies.id, { onDelete: 'set null' }), // sorumlu firma
  employeeId: text('employee_id').references(() => employees.id, { onDelete: 'set null' }), // uygunsuz davranışta bulunan çalışan
  openedById: text('opened_by_id').notNull().references(() => users.id),
  description: text('description').notNull(),
  correctionSuggestion: text('correction_suggestion'), // açan kişinin önerdiği düzeltme yöntemi
  riskScore: integer('risk_score'), // 1 (düşük) - 5 (kritik) risk/şiddet skoru
  priority: nonconformityPriorityEnum('priority').notNull().default('ORTA'),
  status: nonconformityStatusEnum('status').notNull().default('ACIK'),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(), // termin tarihi
  closedAt: timestamp('closed_at', { withTimezone: true }),
  deadlineReminderSentAt: timestamp('deadline_reminder_sent_at', { withTimezone: true }), // termin %66'sı dolunca gönderilen uyarı
  deadlineExpiredNotifiedAt: timestamp('deadline_expired_notified_at', { withTimezone: true }), // termin tarihi geçince açan+atananlara gönderilen bildirim
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('nonconformities_number_idx').on(table.number),
  index('nonconformities_project_status_idx').on(table.projectId, table.status),
]);

/**
 * Bir uygunsuzluğa atanan kişiler (çoklu atama desteklenir). Atananlardan herhangi biri
 * düzeltme gönderebilir.
 */
const nonconformityAssignees = pgTable('nonconformity_assignees', {
  id: text('id').primaryKey().$defaultFn(genId),
  nonconformityId: text('nonconformity_id').notNull().references(() => nonconformities.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('nonconformity_assignees_unique_idx').on(table.nonconformityId, table.userId),
  index('nonconformity_assignees_user_idx').on(table.userId),
]);

/**
 * Sorumlu kişinin gönderdiği düzeltme bildirimi. Onaylanana/reddedilene kadar BEKLEMEDE'dir.
 */
const nonconformityCorrections = pgTable('nonconformity_corrections', {
  id: text('id').primaryKey().$defaultFn(genId),
  nonconformityId: text('nonconformity_id').notNull().references(() => nonconformities.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  submittedById: text('submitted_by_id').notNull().references(() => users.id),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  status: correctionStatusEnum('status').notNull().default('BEKLEMEDE'),
  reviewedById: text('reviewed_by_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
}, (table) => [
  index('nonconformity_corrections_nc_idx').on(table.nonconformityId),
]);

/**
 * Uygunsuzluğa ait fotoğraflar (açılış, düzeltme, itiraz, ceza vb.). Dosyalar Cloudflare R2'de
 * (S3-uyumlu, private bucket) tutulur; burada yalnızca object key saklanır, görüntüleme için
 * backend kısa ömürlü presigned URL üretir.
 */
const nonconformityPhotos = pgTable('nonconformity_photos', {
  id: text('id').primaryKey().$defaultFn(genId),
  nonconformityId: text('nonconformity_id').notNull().references(() => nonconformities.id, { onDelete: 'cascade' }),
  correctionId: text('correction_id').references(() => nonconformityCorrections.id, { onDelete: 'cascade' }),
  type: nonconformityPhotoTypeEnum('type').notNull().default('DIGER'),
  objectKey: text('object_key').notNull(), // R2 bucket içindeki dosya yolu
  originalFileName: text('original_file_name'),
  uploadedById: text('uploaded_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('nonconformity_photos_nc_idx').on(table.nonconformityId),
]);

/**
 * Kullanıcıya yönelik uygulama içi bildirimler (ör. "size bir uygunsuzluk atandı").
 */
const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(genId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  nonconformityId: text('nonconformity_id').references(() => nonconformities.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('notifications_user_idx').on(table.userId, table.isRead),
]);

/**
 * Uygunsuzluğun değiştirilemez işlem geçmişi (tarihçe). Her durum değişikliğinde bir satır eklenir.
 */
const nonconformityStatusHistory = pgTable('nonconformity_status_history', {
  id: text('id').primaryKey().$defaultFn(genId),
  nonconformityId: text('nonconformity_id').notNull().references(() => nonconformities.id, { onDelete: 'cascade' }),
  fromStatus: nonconformityStatusEnum('from_status'),
  toStatus: nonconformityStatusEnum('to_status').notNull(),
  actorId: text('actor_id').notNull().references(() => users.id),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('nonconformity_status_history_nc_idx').on(table.nonconformityId),
]);

/**
 * Termin süresi geçmiş ve hâlâ kapatılmamış bir uygunsuzluk için açan kişi tarafından talep
 * edilen cezai işlem. Admin ve "ceza onaylama" yetkisine sahip kişiler onaylar/reddeder.
 * NOT: "İş akdi feshi" gibi yaptırım türleri yalnızca bir KARAR KAYDIDIR; sistem bunu
 * otomatik olarak uygulamaz, gerçek dünyadaki idari işlem şirket/İK süreçleriyle yürütülür.
 */
const penalties = pgTable('penalties', {
  id: text('id').primaryKey().$defaultFn(genId),
  nonconformityId: text('nonconformity_id').notNull().references(() => nonconformities.id, { onDelete: 'cascade' }),
  employeeId: text('employee_id').references(() => employees.id, { onDelete: 'set null' }),
  requestedById: text('requested_by_id').notNull().references(() => users.id),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason').notNull(),
  sanctionType: penaltySanctionEnum('sanction_type').notNull().default('PARA_CEZASI'),
  suggestedAmount: integer('suggested_amount'), // TL, opsiyonel
  status: penaltyStatusEnum('status').notNull().default('BEKLEMEDE'),
  decidedById: text('decided_by_id').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('penalties_nonconformity_idx').on(table.nonconformityId),
  index('penalties_employee_idx').on(table.employeeId),
  index('penalties_status_idx').on(table.status),
]);

/**
 * Termin (ek süre) talebi: uygunsuzluğun termin tarihi dolduğunda/dolmak üzereyken, atanan
 * kişi ceza almamak için ek süre talep edebilir. Talep, uygunsuzluğu açan kişiye (veya admine)
 * onaya gider; onaylanırsa uygunsuzluğun termin tarihi güncellenir, reddedilirse açan kişi
 * dilerse ayrıca cezai işlem talebinde bulunabilir (mevcut ceza talebi akışı üzerinden).
 */
const dueDateExtensions = pgTable('due_date_extensions', {
  id: text('id').primaryKey().$defaultFn(genId),
  nonconformityId: text('nonconformity_id').notNull().references(() => nonconformities.id, { onDelete: 'cascade' }),
  requestedById: text('requested_by_id').notNull().references(() => users.id),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  currentDueDate: timestamp('current_due_date', { withTimezone: true }).notNull(), // talep anındaki termin (referans)
  requestedNewDueDate: timestamp('requested_new_due_date', { withTimezone: true }).notNull(),
  reason: text('reason').notNull(),
  status: extensionStatusEnum('status').notNull().default('BEKLEMEDE'),
  decidedById: text('decided_by_id').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('due_date_extensions_nonconformity_idx').on(table.nonconformityId),
  index('due_date_extensions_status_idx').on(table.status),
]);

/**
 * Tarayıcı Web Push abonelikleri (uygulama/tarayıcı kapalıyken bile bildirim gösterebilmek için).
 */
const pushSubscriptions = pgTable('push_subscriptions', {
  id: text('id').primaryKey().$defaultFn(genId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('push_subscriptions_endpoint_idx').on(table.endpoint),
  index('push_subscriptions_user_idx').on(table.userId),
]);

/**
 * Aylık arşiv kayıtları: admin belirli bir proje + ay (ör. "2026-08") için tüm uygunsuzluk
 * verisini (fotoğraflar dahil) bir zip dosyası olarak dışa aktardığında burada bir kayıt
 * oluşturulur (OLUSTURULDU). Admin dosyayı kaydettiğini onaylayıp o ayın kayıtlarını
 * sunucudan sildiğinde durum SILINDI'ye geçer. Aynı proje+ay için tekrar arşiv üretilirse
 * (SILINDI olsa dahi) yeni bir zip indirilebilir, ama silme yalnızca hâlâ OLUSTURULDU
 * durumundaki (yani sunucuda hâlâ var olan) kayıtlar için mümkündür.
 */
const archives = pgTable('archives', {
  id: text('id').primaryKey().$defaultFn(genId),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  periodLabel: text('period_label').notNull(), // 'YYYY-MM'
  recordCount: integer('record_count').notNull().default(0),
  status: archiveStatusEnum('status').notNull().default('OLUSTURULDU'),
  createdById: text('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedById: text('deleted_by_id').references(() => users.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('archives_project_period_idx').on(table.projectId, table.periodLabel),
]);
const archivesRelations = relations(archives, ({ one }) => ({
  project: one(projects, { fields: [archives.projectId], references: [projects.id] }),
  createdBy: one(users, { fields: [archives.createdById], references: [users.id] }),
  deletedBy: one(users, { fields: [archives.deletedById], references: [users.id] }),
}));

/**
 * Firma bünyesindeki organizasyonel roller (İşveren, İşveren Vekili, Şantiye Şefi, Çalışan
 * Temsilcisi, Destek Personeli, Proje Müdürü, İSG Uzmanı, İşyeri Hekimi, Diğer Sağlık
 * Personeli) ve acil durum ekipleri (İlkyardım, Arama-Kurtarma, Koruma) için tek bir atama
 * tablosu. Kişi ya firmanın çalışan listesinden (employeeId) ya da dışarıdan/OSGB üzerinden
 * (outside* alanları) gelebilir. Bir kişi birden fazla role sahip olabileceği için her rol
 * ayrı bir satırdır. Sertifika alanları role göre kullanılır (ör. İSG Uzmanı için
 * certificateClass = "B Sınıfı", İlkyardım için certificateStartDate/EndDate).
 */
/**
 * Firma rolü tipi kataloğu (İşveren, Şantiye Şefi, İSG Uzmanı, İlkyardımcı vb.). Admin
 * "Görevler" sayfasından (Firma Rolleri bölümü) yeni tip ekleyebilir/silebilir; buradaki
 * her satır companyRoleAssignments.roleType tarafından "key" üzerinden referans alınır.
 * category: 'FIRMA_ROLU' (Roller & Ekipler sekmesindeki "Firma Rolleri" grubu) veya
 * 'ACIL_EKIP' ("Acil Durum Ekipleri" grubu).
 */
const companyRoleTypes = pgTable('company_role_types', {
  id: text('id').primaryKey().$defaultFn(genId),
  key: text('key').notNull(),
  label: text('label').notNull(),
  category: text('category').notNull().default('FIRMA_ROLU'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('company_role_types_key_idx').on(table.key),
]);

const companyRoleAssignments = pgTable('company_role_assignments', {
  id: text('id').primaryKey().$defaultFn(genId),
  companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  roleType: text('role_type').notNull().references(() => companyRoleTypes.key),
  source: companyRoleSourceEnum('source').notNull().default('CALISAN'),
  employeeId: text('employee_id').references(() => employees.id, { onDelete: 'set null' }),
  outsideFullName: text('outside_full_name'),
  outsideCompanyName: text('outside_company_name'), // ör. hizmet alınan OSGB adı
  outsideNationalId: text('outside_national_id'),
  outsidePhone: text('outside_phone'),
  certificateNo: text('certificate_no'),
  certificateClass: text('certificate_class'), // ör. İSG Uzmanı "B Sınıfı", İşyeri Hekimi sınıfı
  certificateStartDate: timestamp('certificate_start_date', { withTimezone: true }),
  certificateEndDate: timestamp('certificate_end_date', { withTimezone: true }),
  notes: text('notes'),
  createdById: text('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('company_role_assignments_company_idx').on(table.companyId),
  index('company_role_assignments_employee_idx').on(table.employeeId),
]);

/**
 * Kaza ve ramak kala olay kayıtları. Mevzuata uygun temel alanları taşır. Ramak kala
 * olaylarında kazazede/hastane/rapor alanları genelde boş bırakılır.
 */
const incidents = pgTable('incidents', {
  id: text('id').primaryKey().$defaultFn(genId),
  companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  type: incidentTypeEnum('type').notNull(),
  eventDateTime: timestamp('event_date_time', { withTimezone: true }).notNull(),
  employeeId: text('employee_id').references(() => employees.id, { onDelete: 'set null' }), // kazayı geçiren çalışan
  eventDescription: text('event_description').notNull(), // olay şekli
  location: text('location'), // olay yeri
  cause: text('cause'), // kazanın/olayın sebebi
  witnessEmployeeId: text('witness_employee_id').references(() => employees.id, { onDelete: 'set null' }),
  witnessStatement: text('witness_statement'),
  referredToHospital: boolean('referred_to_hospital').notNull().default(false),
  hospitalName: text('hospital_name'),
  firstAidGiven: boolean('first_aid_given').notNull().default(false),
  firstAidGivenBy: text('first_aid_given_by'),
  victimProfession: text('victim_profession'),
  doctorReportPhotoKey: text('doctor_report_photo_key'), // R2 object key
  reportDaysOff: integer('report_days_off'),
  returnToWorkDate: timestamp('return_to_work_date', { withTimezone: true }),
  actionsTaken: text('actions_taken'),
  createdById: text('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('incidents_company_idx').on(table.companyId, table.type),
]);

/**
 * Firmanın risk analizi raporu ve acil durum eylem planı gibi periyodik/onaylı belgeleri.
 */
const companyDocuments = pgTable('company_documents', {
  id: text('id').primaryKey().$defaultFn(genId),
  companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  docType: companyDocTypeEnum('doc_type').notNull(),
  preparedDate: timestamp('prepared_date', { withTimezone: true }),
  approved: boolean('approved').notNull().default(false),
  approvedDate: timestamp('approved_date', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  fileObjectKey: text('file_object_key'),
  notes: text('notes'),
  createdById: text('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('company_documents_company_idx').on(table.companyId, table.docType),
]);

/**
 * İSG kurulu toplantı kayıtları. Normal (periyodik) ve olağanüstü toplantılar aynı tabloda,
 * isExtraordinary alanıyla ayrılır. Bir dönemde (periodLabel) hem normal hem birden fazla
 * olağanüstü toplantı olabilir.
 */
const boardMeetings = pgTable('board_meetings', {
  id: text('id').primaryKey().$defaultFn(genId),
  companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  meetingDate: timestamp('meeting_date', { withTimezone: true }).notNull(),
  periodLabel: text('period_label').notNull(), // 'YYYY-MM'
  isExtraordinary: boolean('is_extraordinary').notNull().default(false),
  attendanceFormFileKey: text('attendance_form_file_key'), // imzalı katılım formu (R2)
  notes: text('notes'),
  createdById: text('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('board_meetings_company_period_idx').on(table.companyId, table.periodLabel),
]);

/**
 * Sahada kullanılan ekipman/iş makinesi listesi. Proje + firma bazlıdır; kişiye ya da firmaya
 * zimmetli olabilir, operatörü çalışan listesinden ya da dışarıdan (belge bilgileriyle) olabilir.
 */
const equipment = pgTable('equipment', {
  id: text('id').primaryKey().$defaultFn(genId),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // ekipman adı/tipi
  serialNumber: text('serial_number'),
  licenseNumber: text('license_number'), // ruhsat no
  periodicInspectionDate: timestamp('periodic_inspection_date', { withTimezone: true }),
  periodicInspectionValidUntil: timestamp('periodic_inspection_valid_until', { withTimezone: true }),
  hasDamage: boolean('has_damage').notNull().default(false),
  damageDescription: text('damage_description'),
  fitForUse: boolean('fit_for_use').notNull().default(true),
  assignedTo: equipmentAssignedToEnum('assigned_to').notNull().default('FIRMA'),
  assignedEmployeeId: text('assigned_employee_id').references(() => employees.id, { onDelete: 'set null' }),
  operatorSource: equipmentOperatorSourceEnum('operator_source').notNull().default('YOK'),
  operatorEmployeeId: text('operator_employee_id').references(() => employees.id, { onDelete: 'set null' }),
  operatorOutsideFullName: text('operator_outside_full_name'),
  operatorOutsideCompanyName: text('operator_outside_company_name'),
  operatorOutsideNationalId: text('operator_outside_national_id'),
  operatorOutsideSgkNo: text('operator_outside_sgk_no'),
  operatorCertificateNo: text('operator_certificate_no'),
  createdById: text('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('equipment_project_company_idx').on(table.projectId, table.companyId),
]);

/** Sistem geneli basit ayarlar (ör. galeriden fotoğraf seçmeye izin verilsin mi). */
const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Davet bağlantıları: admin bir kullanıcı için tek kullanımlık, süreli bir link üretir
 * (ör. WhatsApp ile gönderilir). Kullanıcı linke tıklayıp kendi şifresini belirler.
 * Ham token asla DB'ye yazılmaz, yalnızca sha256 hash'i saklanır.
 */
const userInvites = pgTable('user_invites', {
  id: text('id').primaryKey().$defaultFn(genId),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('user_invites_token_hash_idx').on(table.tokenHash),
  index('user_invites_user_idx').on(table.userId),
]);

// Kritik/geri dönülmez işlemler (firma silme/düzenleme, proje değişikliği, uygunsuzluk silme,
// ceza onaylama vb.) için admin onay kuyruğu. Admin olmayan bir kullanıcı bu işlemlerden birini
// tetiklediğinde işlem hemen uygulanmaz; burada BEKLEMEDE bir kayıt oluşur ve yalnızca sistem
// admini onaylarsa `actionType`'a karşılık gelen işlem (bkz. services/criticalActions.service.js
// EXECUTORS) gerçekten uygulanır. Admin kendisi aynı işlemi yaparsa bu tabloya hiç uğramadan
// anında uygulanır (bkz. utils/approval.js runOrQueueForApproval).
const pendingApprovals = pgTable('pending_approvals', {
  id: text('id').primaryKey().$defaultFn(genId),
  actionType: text('action_type').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  // Onaylandığında ilgili EXECUTORS[actionType] fonksiyonuna aynen geçirilecek veri.
  payload: jsonb('payload').notNull().default({}),
  // Admin onay ekranında gösterilecek insan-okunur özet, örn: '"ABC İnşaat" firması silinecek (pasife alınacak)'.
  summary: text('summary').notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  status: approvalStatusEnum('status').notNull().default('BEKLEMEDE'),
  requestedById: text('requested_by_id').notNull().references(() => users.id),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  decidedById: text('decided_by_id').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
}, (table) => [
  index('pending_approvals_status_idx').on(table.status),
  index('pending_approvals_project_idx').on(table.projectId),
]);

// İlişkiler (relational query API için)
const usersRelations = relations(users, ({ one, many }) => ({
  companyUsers: many(companyUsers),
  userProjects: many(userProjects),
  userPermissions: many(userPermissions),
  auditLogs: many(auditLogs),
  openedNonconformities: many(nonconformities, { relationName: 'openedBy' }),
  nonconformityAssignments: many(nonconformityAssignees),
  notifications: many(notifications),
  pushSubscriptions: many(pushSubscriptions),
  invites: many(userInvites),
  employee: one(employees, { fields: [users.employeeId], references: [employees.id] }),
}));

const projectsRelations = relations(projects, ({ many }) => ({
  blocks: many(projectBlocks),
  companies: many(companies),
  userProjects: many(userProjects),
  categories: many(categories),
  nonconformities: many(nonconformities),
}));

const projectBlocksRelations = relations(projectBlocks, ({ one, many }) => ({
  project: one(projects, { fields: [projectBlocks.projectId], references: [projects.id] }),
  responsibleCompanies: many(companies),
}));

const companiesRelations = relations(companies, ({ one, many }) => ({
  project: one(projects, { fields: [companies.projectId], references: [projects.id] }),
  responsibleBlock: one(projectBlocks, { fields: [companies.responsibleBlockId], references: [projectBlocks.id] }),
  companyUsers: many(companyUsers),
  userProjects: many(userProjects),
  employees: many(employees),
  companyBlocks: many(companyBlocks),
}));

const companyUsersRelations = relations(companyUsers, ({ one }) => ({
  company: one(companies, { fields: [companyUsers.companyId], references: [companies.id] }),
  user: one(users, { fields: [companyUsers.userId], references: [users.id] }),
}));

const companyBlocksRelations = relations(companyBlocks, ({ one }) => ({
  company: one(companies, { fields: [companyBlocks.companyId], references: [companies.id] }),
  block: one(projectBlocks, { fields: [companyBlocks.blockId], references: [projectBlocks.id] }),
}));

const companyRoleTypesRelations = relations(companyRoleTypes, ({ many }) => ({
  assignments: many(companyRoleAssignments),
}));

const rolesRelations = relations(roles, ({ many }) => ({
  userProjects: many(userProjects),
}));

const permissionsRelations = relations(permissions, ({ many }) => ({
  userPermissions: many(userPermissions),
}));

const userProjectsRelations = relations(userProjects, ({ one }) => ({
  user: one(users, { fields: [userProjects.userId], references: [users.id] }),
  project: one(projects, { fields: [userProjects.projectId], references: [projects.id] }),
  role: one(roles, { fields: [userProjects.roleId], references: [roles.id] }),
  company: one(companies, { fields: [userProjects.companyId], references: [companies.id] }),
  block: one(projectBlocks, { fields: [userProjects.blockId], references: [projectBlocks.id] }),
}));

const userPermissionsRelations = relations(userPermissions, ({ one }) => ({
  user: one(users, { fields: [userPermissions.userId], references: [users.id] }),
  project: one(projects, { fields: [userPermissions.projectId], references: [projects.id] }),
  permission: one(permissions, { fields: [userPermissions.permissionId], references: [permissions.id] }),
}));

const categoriesRelations = relations(categories, ({ one }) => ({
  project: one(projects, { fields: [categories.projectId], references: [projects.id] }),
}));

const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

const employeesRelations = relations(employees, ({ one, many }) => ({
  project: one(projects, { fields: [employees.projectId], references: [projects.id] }),
  company: one(companies, { fields: [employees.companyId], references: [companies.id] }),
  nonconformities: many(nonconformities),
  penalties: many(penalties),
}));

const nonconformitiesRelations = relations(nonconformities, ({ one, many }) => ({
  project: one(projects, { fields: [nonconformities.projectId], references: [projects.id] }),
  category: one(categories, { fields: [nonconformities.categoryId], references: [categories.id] }),
  block: one(projectBlocks, { fields: [nonconformities.blockId], references: [projectBlocks.id] }),
  company: one(companies, { fields: [nonconformities.companyId], references: [companies.id] }),
  employee: one(employees, { fields: [nonconformities.employeeId], references: [employees.id] }),
  openedBy: one(users, { fields: [nonconformities.openedById], references: [users.id], relationName: 'openedBy' }),
  assignees: many(nonconformityAssignees),
  photos: many(nonconformityPhotos),
  corrections: many(nonconformityCorrections),
  history: many(nonconformityStatusHistory),
  penalties: many(penalties),
  dueDateExtensions: many(dueDateExtensions),
}));

const nonconformityAssigneesRelations = relations(nonconformityAssignees, ({ one }) => ({
  nonconformity: one(nonconformities, { fields: [nonconformityAssignees.nonconformityId], references: [nonconformities.id] }),
  user: one(users, { fields: [nonconformityAssignees.userId], references: [users.id] }),
}));

const nonconformityCorrectionsRelations = relations(nonconformityCorrections, ({ one, many }) => ({
  nonconformity: one(nonconformities, { fields: [nonconformityCorrections.nonconformityId], references: [nonconformities.id] }),
  submittedBy: one(users, { fields: [nonconformityCorrections.submittedById], references: [users.id] }),
  reviewedBy: one(users, { fields: [nonconformityCorrections.reviewedById], references: [users.id] }),
  photos: many(nonconformityPhotos),
}));

const nonconformityPhotosRelations = relations(nonconformityPhotos, ({ one }) => ({
  nonconformity: one(nonconformities, { fields: [nonconformityPhotos.nonconformityId], references: [nonconformities.id] }),
  correction: one(nonconformityCorrections, { fields: [nonconformityPhotos.correctionId], references: [nonconformityCorrections.id] }),
  uploadedBy: one(users, { fields: [nonconformityPhotos.uploadedById], references: [users.id] }),
}));

const nonconformityStatusHistoryRelations = relations(nonconformityStatusHistory, ({ one }) => ({
  nonconformity: one(nonconformities, { fields: [nonconformityStatusHistory.nonconformityId], references: [nonconformities.id] }),
  actor: one(users, { fields: [nonconformityStatusHistory.actorId], references: [users.id] }),
}));

const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  nonconformity: one(nonconformities, { fields: [notifications.nonconformityId], references: [nonconformities.id] }),
}));

const penaltiesRelations = relations(penalties, ({ one }) => ({
  nonconformity: one(nonconformities, { fields: [penalties.nonconformityId], references: [nonconformities.id] }),
  employee: one(employees, { fields: [penalties.employeeId], references: [employees.id] }),
  requestedBy: one(users, { fields: [penalties.requestedById], references: [users.id] }),
  decidedBy: one(users, { fields: [penalties.decidedById], references: [users.id] }),
}));

const dueDateExtensionsRelations = relations(dueDateExtensions, ({ one }) => ({
  nonconformity: one(nonconformities, { fields: [dueDateExtensions.nonconformityId], references: [nonconformities.id] }),
  requestedBy: one(users, { fields: [dueDateExtensions.requestedById], references: [users.id] }),
  decidedBy: one(users, { fields: [dueDateExtensions.decidedById], references: [users.id] }),
}));

const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [pushSubscriptions.userId], references: [users.id] }),
}));

const userInvitesRelations = relations(userInvites, ({ one }) => ({
  user: one(users, { fields: [userInvites.userId], references: [users.id] }),
}));

const pendingApprovalsRelations = relations(pendingApprovals, ({ one }) => ({
  project: one(projects, { fields: [pendingApprovals.projectId], references: [projects.id] }),
  requestedBy: one(users, { fields: [pendingApprovals.requestedById], references: [users.id] }),
  decidedBy: one(users, { fields: [pendingApprovals.decidedById], references: [users.id] }),
}));

module.exports = {
  companyTypeEnum,
  projectStatusEnum,
  approvalStatusEnum,
  nonconformityStatusEnum,
  nonconformityPriorityEnum,
  nonconformityPhotoTypeEnum,
  correctionStatusEnum,
  penaltySanctionEnum,
  penaltyStatusEnum,
  extensionStatusEnum,
  archiveStatusEnum,
  companyRoleSourceEnum,
  incidentTypeEnum,
  companyDocTypeEnum,
  dangerClassEnum,
  equipmentAssignedToEnum,
  equipmentOperatorSourceEnum,
  users,
  projects,
  projectBlocks,
  companies,
  companyUsers,
  roles,
  permissions,
  userProjects,
  userPermissions,
  categories,
  auditLogs,
  employees,
  nonconformities,
  nonconformityAssignees,
  notifications,
  nonconformityCorrections,
  nonconformityPhotos,
  nonconformityStatusHistory,
  penalties,
  dueDateExtensions,
  pushSubscriptions,
  systemSettings,
  userInvites,
  pendingApprovals,
  archives,
  companyBlocks,
  companyRoleTypes,
  companyRoleAssignments,
  incidents,
  companyDocuments,
  boardMeetings,
  equipment,
  archivesRelations,
  usersRelations,
  projectsRelations,
  projectBlocksRelations,
  companiesRelations,
  companyUsersRelations,
  companyBlocksRelations,
  companyRoleTypesRelations,
  rolesRelations,
  permissionsRelations,
  userProjectsRelations,
  userPermissionsRelations,
  categoriesRelations,
  auditLogsRelations,
  nonconformitiesRelations,
  nonconformityAssigneesRelations,
  notificationsRelations,
  nonconformityCorrectionsRelations,
  nonconformityPhotosRelations,
  nonconformityStatusHistoryRelations,
  employeesRelations,
  penaltiesRelations,
  dueDateExtensionsRelations,
  pushSubscriptionsRelations,
  pendingApprovalsRelations,
};
