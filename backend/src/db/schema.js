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
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('user_projects_unique_idx').on(table.userId, table.projectId, table.roleId),
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
const nonconformities = pgTable('nonconformities', {
  id: text('id').primaryKey().$defaultFn(genId),
  number: text('number').notNull(), // örn. 2026-ANK-000125
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  blockId: text('block_id').references(() => projectBlocks.id, { onDelete: 'set null' }),
  companyId: text('company_id').references(() => companies.id, { onDelete: 'set null' }), // sorumlu firma
  openedById: text('opened_by_id').notNull().references(() => users.id),
  assignedUserId: text('assigned_user_id').notNull().references(() => users.id), // atanan kişi
  description: text('description').notNull(),
  priority: nonconformityPriorityEnum('priority').notNull().default('ORTA'),
  status: nonconformityStatusEnum('status').notNull().default('ACIK'),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(), // termin tarihi
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('nonconformities_number_idx').on(table.number),
  index('nonconformities_project_status_idx').on(table.projectId, table.status),
  index('nonconformities_assigned_idx').on(table.assignedUserId),
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

// İlişkiler (relational query API için)
const usersRelations = relations(users, ({ many }) => ({
  companyUsers: many(companyUsers),
  userProjects: many(userProjects),
  userPermissions: many(userPermissions),
  auditLogs: many(auditLogs),
  openedNonconformities: many(nonconformities, { relationName: 'openedBy' }),
  assignedNonconformities: many(nonconformities, { relationName: 'assignedTo' }),
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

const nonconformitiesRelations = relations(nonconformities, ({ one, many }) => ({
  project: one(projects, { fields: [nonconformities.projectId], references: [projects.id] }),
  category: one(categories, { fields: [nonconformities.categoryId], references: [categories.id] }),
  block: one(projectBlocks, { fields: [nonconformities.blockId], references: [projectBlocks.id] }),
  company: one(companies, { fields: [nonconformities.companyId], references: [companies.id] }),
  openedBy: one(users, { fields: [nonconformities.openedById], references: [users.id], relationName: 'openedBy' }),
  assignedUser: one(users, { fields: [nonconformities.assignedUserId], references: [users.id], relationName: 'assignedTo' }),
  photos: many(nonconformityPhotos),
  corrections: many(nonconformityCorrections),
  history: many(nonconformityStatusHistory),
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

module.exports = {
  companyTypeEnum,
  projectStatusEnum,
  nonconformityStatusEnum,
  nonconformityPriorityEnum,
  nonconformityPhotoTypeEnum,
  correctionStatusEnum,
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
  nonconformities,
  nonconformityCorrections,
  nonconformityPhotos,
  nonconformityStatusHistory,
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
  nonconformityCorrectionsRelations,
  nonconformityPhotosRelations,
  nonconformityStatusHistoryRelations,
};
