const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { db } = require('../../db/client');
const { users, userProjects, userPermissions, projects, roles, permissions } = require('../../db/schema');
const { eq, and } = require('drizzle-orm');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requirePermission } = require('../../middleware/permission');
const { hashPassword } = require('../../utils/password');
const { logAudit } = require('../../utils/audit');

const router = express.Router();
router.use(requirePermission('kullanici_yonetme'));

function generateTempPassword() {
  // Okunması kolay, yeterince güçlü geçici şifre üretir. Örn: "Isg-7F3kQ2z9"
  return `Isg-${crypto.randomBytes(6).toString('base64url')}`;
}

const createUserSchema = z.object({
  fullName: z.string().min(2, 'Ad soyad en az 2 karakter olmalıdır.'),
  username: z.string().min(3, 'Kullanıcı adı en az 3 karakter olmalıdır.'),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        phone: users.phone,
        email: users.email,
        isActive: users.isActive,
        isSystemAdmin: users.isSystemAdmin,
        mustChangePassword: users.mustChangePassword,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(users.createdAt);
    res.json({ users: rows });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz kullanıcı bilgisi.', parsed.error.flatten());

    const existing = await db.select().from(users).where(eq(users.username, parsed.data.username)).limit(1);
    if (existing.length > 0) throw ApiError.conflict('Bu kullanıcı adı zaten kullanımda.');

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const [created] = await db
      .insert(users)
      .values({
        fullName: parsed.data.fullName,
        username: parsed.data.username,
        phone: parsed.data.phone || null,
        email: parsed.data.email || null,
        passwordHash,
        mustChangePassword: true,
      })
      .returning();

    await logAudit({ userId: req.user.sub, action: 'USER_CREATE', entityType: 'user', entityId: created.id, details: { username: created.username }, ipAddress: req.ip });

    const { passwordHash: _omit, ...safeUser } = created;
    res.status(201).json({ user: safeUser, tempPassword });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    if (!user) throw ApiError.notFound('Kullanıcı bulunamadı.');

    const assignments = await db
      .select({
        id: userProjects.id,
        projectId: projects.id,
        projectName: projects.name,
        roleId: roles.id,
        roleName: roles.name,
        isActive: userProjects.isActive,
      })
      .from(userProjects)
      .innerJoin(projects, eq(userProjects.projectId, projects.id))
      .innerJoin(roles, eq(userProjects.roleId, roles.id))
      .where(eq(userProjects.userId, user.id));

    const grantedPermissions = await db
      .select({
        id: userPermissions.id,
        permissionId: permissions.id,
        key: permissions.key,
        name: permissions.name,
        projectId: userPermissions.projectId,
        granted: userPermissions.granted,
      })
      .from(userPermissions)
      .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
      .where(eq(userPermissions.userId, user.id));

    const { passwordHash, ...safeUser } = user;
    res.json({ user: safeUser, assignments, permissions: grantedPermissions });
  })
);

const updateUserSchema = createUserSchema.partial().extend({
  isActive: z.boolean().optional(),
});

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz kullanıcı bilgisi.', parsed.error.flatten());

    const [updated] = await db
      .update(users)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(users.id, req.params.id))
      .returning();
    if (!updated) throw ApiError.notFound('Kullanıcı bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'USER_UPDATE', entityType: 'user', entityId: updated.id, details: parsed.data, ipAddress: req.ip });
    const { passwordHash, ...safeUser } = updated;
    res.json({ user: safeUser });
  })
);

router.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    if (!user) throw ApiError.notFound('Kullanıcı bulunamadı.');

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    await db.update(users).set({ passwordHash, mustChangePassword: true }).where(eq(users.id, user.id));

    await logAudit({ userId: req.user.sub, action: 'USER_PASSWORD_RESET', entityType: 'user', entityId: user.id, ipAddress: req.ip });
    res.json({ tempPassword });
  })
);

const assignProjectSchema = z.object({
  projectId: z.string().min(1),
  roleId: z.string().min(1),
});

router.post(
  '/:id/projects',
  asyncHandler(async (req, res) => {
    const parsed = assignProjectSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());

    const duplicate = await db
      .select()
      .from(userProjects)
      .where(
        and(
          eq(userProjects.userId, req.params.id),
          eq(userProjects.projectId, parsed.data.projectId),
          eq(userProjects.roleId, parsed.data.roleId)
        )
      )
      .limit(1);
    if (duplicate.length > 0) throw ApiError.conflict('Bu kullanıcı bu proje/görev kombinasyonuna zaten atanmış.');

    const [created] = await db
      .insert(userProjects)
      .values({ userId: req.params.id, projectId: parsed.data.projectId, roleId: parsed.data.roleId })
      .returning();

    await logAudit({ userId: req.user.sub, action: 'USER_PROJECT_ASSIGN', entityType: 'user_project', entityId: created.id, details: parsed.data, ipAddress: req.ip });
    res.status(201).json({ assignment: created });
  })
);

router.patch(
  '/:id/projects/:userProjectId',
  asyncHandler(async (req, res) => {
    const schema = z.object({ isActive: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());

    const [updated] = await db
      .update(userProjects)
      .set({ isActive: parsed.data.isActive })
      .where(and(eq(userProjects.id, req.params.userProjectId), eq(userProjects.userId, req.params.id)))
      .returning();
    if (!updated) throw ApiError.notFound('Atama bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'USER_PROJECT_UPDATE', entityType: 'user_project', entityId: updated.id, details: parsed.data, ipAddress: req.ip });
    res.json({ assignment: updated });
  })
);

router.delete(
  '/:id/projects/:userProjectId',
  asyncHandler(async (req, res) => {
    const [deleted] = await db
      .delete(userProjects)
      .where(and(eq(userProjects.id, req.params.userProjectId), eq(userProjects.userId, req.params.id)))
      .returning();
    if (!deleted) throw ApiError.notFound('Atama bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'USER_PROJECT_REMOVE', entityType: 'user_project', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

const grantPermissionSchema = z.object({
  permissionId: z.string().min(1),
  projectId: z.string().optional().nullable(),
  granted: z.boolean().default(true),
});

router.post(
  '/:id/permissions',
  asyncHandler(async (req, res) => {
    const parsed = grantPermissionSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());

    const [created] = await db
      .insert(userPermissions)
      .values({
        userId: req.params.id,
        permissionId: parsed.data.permissionId,
        projectId: parsed.data.projectId || null,
        granted: parsed.data.granted,
      })
      .onConflictDoNothing()
      .returning();

    if (!created) throw ApiError.conflict('Bu yetki zaten tanımlı.');

    await logAudit({ userId: req.user.sub, action: 'USER_PERMISSION_GRANT', entityType: 'user_permission', entityId: created.id, details: parsed.data, ipAddress: req.ip });
    res.status(201).json({ permission: created });
  })
);

router.delete(
  '/:id/permissions/:userPermissionId',
  asyncHandler(async (req, res) => {
    const [deleted] = await db
      .delete(userPermissions)
      .where(and(eq(userPermissions.id, req.params.userPermissionId), eq(userPermissions.userId, req.params.id)))
      .returning();
    if (!deleted) throw ApiError.notFound('Yetki kaydı bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'USER_PERMISSION_REVOKE', entityType: 'user_permission', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
