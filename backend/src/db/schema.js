// Yerel Uygunsuzluk ve İSG Takip Sistemi - Drizzle ORM şeması (FAZ 1)
// Not: Uygunsuzluk, itiraz, ceza, bildirim vb. tablolar FAZ 2+ aşamalarında eklenecektir.

const { pgTable, text, boolean, timestamp, jsonb, pgEnum, uniqueIndex, index } = require('drizzle-orm/pg-core');
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

// İlişkiler (relational query API için)
const usersRelations = relations(users, ({ many }) => ({
  companyUsers: many(companyUsers),
  userProjects: many(userProjects),
  userPermissions: many(userPermissions),
  auditLogs: many(auditLogs),
}));

const projectsRelations = relations(projects, ({ many }) => ({
  blocks: many(projectBlocks),
  companies: many(companies),
  userProjects: many(userProjects),
  categories: many(categories),
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

module.exports = {
  companyTypeEnum,
  projectStatusEnum,
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
};
