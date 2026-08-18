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
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_username_idx').on(table.username),
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
  isActive: boolean('is_active').notNull().default(true),
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
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('user_projects_unique_idx').on(table.userId, table.projectId, table.roleId, table.companyId),
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
  nationalId: text('national_id'), // T.C. kimlik no, biliniyorsa
  isActive: boolean('is_active').notNull().default(true),
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

// İlişkiler (relational query API için)
const usersRelations = relations(users, ({ many }) => ({
  companyUsers: many(companyUsers),
  userProjects: many(userProjects),
  userPermissions: many(userPermissions),
  auditLogs: many(auditLogs),
  openedNonconformities: many(nonconformities, { relationName: 'openedBy' }),
  nonconformityAssignments: many(nonconformityAssignees),
  notifications: many(notifications),
  pushSubscriptions: many(pushSubscriptions),
  invites: many(userInvites),
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
}));

const companyUsersRelations = relations(companyUsers, ({ one }) => ({
  company: one(companies, { fields: [companyUsers.companyId], references: [companies.id] }),
  user: one(users, { fields: [companyUsers.userId], references: [users.id] }),
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

const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [pushSubscriptions.userId], references: [users.id] }),
}));

const userInvitesRelations = relations(userInvites, ({ one }) => ({
  user: one(users, { fields: [userInvites.userId], references: [users.id] }),
}));

module.exports = {
  companyTypeEnum,
  projectStatusEnum,
  nonconformityStatusEnum,
  nonconformityPriorityEnum,
  nonconformityPhotoTypeEnum,
  correctionStatusEnum,
  penaltySanctionEnum,
  penaltyStatusEnum,
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
  pushSubscriptions,
  systemSettings,
  userInvites,
  usersRelations,
  projectsRelations,
  projectBlocksRelations,
  companiesRelations,
  companyUsersRelations,
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
  pushSubscriptionsRelations,
};
