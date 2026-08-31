const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { db } = require('../../db/client');
const { users, userProjects, userPermissions, projects, roles, permissions, companies, projectBlocks, nonconformities, nonconformityAssignees, userInvites, employees } = require('../../db/schema');
const { eq, and, isNull, count, inArray } = require('drizzle-orm');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requirePermission } = require('../../middleware/permission');
const { hashPassword } = require('../../utils/password');
const { logAudit } = require('../../utils/audit');
const { EXECUTORS } = require('../../services/criticalActions.service');
const { runOrQueueForApproval } = require('../../utils/approval');

const router = express.Router();
router.use(requirePermission('kullanici_yonetme'));

function generateTempPassword() {
  // Okunması kolay, yeterince güçlü geçici şifre üretir. Örn: "Isg-7F3kQ2z9"
  return `Isg-${crypto.randomBytes(6).toString('base64url')}`;
}

function hashInviteToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000; // 7 gün

/** wa.me linki için telefon numarasını Türkiye varsayımıyla normalize eder (rakam dışı her şeyi atar). */
function normalizePhoneForWhatsapp(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('90')) return digits;
  if (digits.startsWith('0')) return `90${digits.slice(1)}`;
  if (digits.length === 10) return `90${digits}`;
  return digits;
}

const createUserSchema = z.object({
  fullName: z.string().min(2, 'Ad soyad en az 2 karakter olmalıdır.'),
  username: z.string().min(3, 'Kullanıcı adı en az 3 karakter olmalıdır.'),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  // Roster'daki (bir firmanın çalışan listesindeki) bilinen bir çalışana bağlanıyorsa doludur.
  // Boşsa "roster dışı" bir kullanıcı ekleniyor demektir - bkz. POST / ve
  // services/criticalActions.service.js executeUserCreate.
  employeeId: z.string().optional().nullable(),
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

    // Her kullanıcının açtığı / kapattığı uygunsuzluk sayıları (tüm projeler dahil).
    const [openedCounts, closedCounts] = await Promise.all([
      db.select({ userId: nonconformities.openedById, value: count() }).from(nonconformities).groupBy(nonconformities.openedById),
      db
        .select({ userId: nonconformityAssignees.userId, value: count() })
        .from(nonconformityAssignees)
        .innerJoin(nonconformities, eq(nonconformityAssignees.nonconformityId, nonconformities.id))
        .where(eq(nonconformities.status, 'KAPALI'))
        .groupBy(nonconformityAssignees.userId),
    ]);
    const openedByUser = new Map(openedCounts.map((r) => [r.userId, r.value]));
    const closedByUser = new Map(closedCounts.map((r) => [r.userId, r.value]));

    const rowsWithStats = rows.map((r) => ({
      ...r,
      openedCount: openedByUser.get(r.id) || 0,
      closedCount: closedByUser.get(r.id) || 0,
    }));

    res.json({ users: rowsWithStats });
  })
);

// ---------------------------------------------------------------------------
// Yeni kullanıcı ekleme akışında "roster" (firma çalışan listeleri) içinden seçim yapılabilmesi
// için, henüz hiçbir kullanıcıya bağlanmamış aktif çalışanları döner. Böyle bir çalışan seçilirse
// kullanıcı doğrudan oluşturulur; seçilmezse (roster dışı) POST / bunu kritik işlem sayıp admin
// onayına yönlendirir - bkz. POST / ve services/criticalActions.service.js executeUserCreate.
// ---------------------------------------------------------------------------
router.get(
  '/employee-candidates',
  asyncHandler(async (req, res) => {
    if (!req.query.projectId) throw ApiError.badRequest('projectId parametresi zorunludur.');

    const rows = await db
      .select({
        id: employees.id,
        fullName: employees.fullName,
        nationalId: employees.nationalId,
        companyId: employees.companyId,
        companyName: companies.name,
        position: employees.position,
      })
      .from(employees)
      .leftJoin(companies, eq(employees.companyId, companies.id))
      .leftJoin(users, eq(users.employeeId, employees.id))
      .where(and(eq(employees.projectId, req.query.projectId), eq(employees.isActive, true), isNull(users.id)))
      .orderBy(employees.fullName);

    res.json({ employees: rows });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz kullanıcı bilgisi.', parsed.error.flatten());

    const payload = {
      fullName: parsed.data.fullName,
      username: parsed.data.username,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      employeeId: parsed.data.employeeId || null,
    };

    if (payload.employeeId) {
      // Roster'daki bilinen bir çalışan seçildi - bu güvenli kabul edilir, admin onayı gerekmez.
      const result = await EXECUTORS.USER_CREATE(payload, req.user.sub);
      res.status(201).json(result);
      return;
    }

    // Roster dışı (hiçbir firmanın çalışan listesinde bulunmayan) bir kullanıcı ekleniyor - bu
    // projeyi geri dönülmez şekilde etkileyebilecek kritik bir durum sayılır: admin ise anında
    // uygulanır, değilse admin onayına kuyruklanır (bkz. utils/approval.js).
    await runOrQueueForApproval(req, res, {
      actionType: 'USER_CREATE',
      entityType: 'user',
      entityId: parsed.data.username,
      payload,
      summary: `"${parsed.data.fullName}" (@${parsed.data.username}) roster dışı bir kullanıcı olarak eklenmek isteniyor - bu kişi projedeki hiçbir firmanın çalışan listesinde bulunmuyor.`,
      successStatus: 201,
    });
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
        companyId: companies.id,
        companyName: companies.name,
        blockId: projectBlocks.id,
        blockName: projectBlocks.name,
        isActive: userProjects.isActive,
      })
      .from(userProjects)
      .innerJoin(projects, eq(userProjects.projectId, projects.id))
      .innerJoin(roles, eq(userProjects.roleId, roles.id))
      .leftJoin(companies, eq(userProjects.companyId, companies.id))
      .leftJoin(projectBlocks, eq(userProjects.blockId, projectBlocks.id))
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

    const [[openedRow], [closedRow], [assignedOpenRow]] = await Promise.all([
      db.select({ value: count() }).from(nonconformities).where(eq(nonconformities.openedById, user.id)),
      db
        .select({ value: count() })
        .from(nonconformityAssignees)
        .innerJoin(nonconformities, eq(nonconformityAssignees.nonconformityId, nonconformities.id))
        .where(and(eq(nonconformityAssignees.userId, user.id), eq(nonconformities.status, 'KAPALI'))),
      db
        .select({ value: count() })
        .from(nonconformityAssignees)
        .innerJoin(nonconformities, eq(nonconformityAssignees.nonconformityId, nonconformities.id))
        .where(and(eq(nonconformityAssignees.userId, user.id), inArray(nonconformities.status, ['ACIK', 'BEKLEMEDE', 'TERMIN_ASIMI']))),
    ]);

    const { passwordHash, ...safeUser } = user;
    res.json({
      user: safeUser,
      assignments,
      permissions: grantedPermissions,
      stats: {
        opened: openedRow?.value || 0,
        closed: closedRow?.value || 0,
        assignedOpen: assignedOpenRow?.value || 0,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// Kullanıcı arşivleme öncesi kontrol: bu kullanıcının bağlı olduğu çalışan kaydı var mı
// (varsa "Çıkış" seçeneği sunulabilir) ve üstünde açık uygunsuzluk var mı (varsa admin
// arşivlemeden önce başka birine yeniden atayabilmeli) - bkz. POST /:id/archive.
// ---------------------------------------------------------------------------
router.get(
  '/:id/archive-check',
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    if (!user) throw ApiError.notFound('Kullanıcı bulunamadı.');

    let linkedEmployee = null;
    if (user.employeeId) {
      const [emp] = await db
        .select({
          id: employees.id,
          fullName: employees.fullName,
          companyId: employees.companyId,
          companyName: companies.name,
          projectId: employees.projectId,
          isActive: employees.isActive,
        })
        .from(employees)
        .leftJoin(companies, eq(employees.companyId, companies.id))
        .where(eq(employees.id, user.employeeId))
        .limit(1);
      linkedEmployee = emp || null;
    }

    const openNonconformities = await db
      .select({
        id: nonconformities.id,
        number: nonconformities.number,
        status: nonconformities.status,
        description: nonconformities.description,
        projectId: nonconformities.projectId,
      })
      .from(nonconformityAssignees)
      .innerJoin(nonconformities, eq(nonconformityAssignees.nonconformityId, nonconformities.id))
      .where(and(eq(nonconformityAssignees.userId, user.id), inArray(nonconformities.status, ['ACIK', 'BEKLEMEDE', 'TERMIN_ASIMI'])));

    const { passwordHash, ...safeUser } = user;
    res.json({ user: safeUser, linkedEmployee, openNonconformities });
  })
);

const archiveUserSchema = z.object({
  mode: z.enum(['EXIT', 'ROLE_CHANGE']),
  // Yalnızca EXIT için kullanılır; boş bırakılırsa bugünün tarihi kullanılır.
  endDate: z.string().optional().nullable(),
  // Üstünde açık uygunsuzluk varsa, arşivlemeden önce başka bir kullanıcıya devretmek için.
  reassignments: z.array(z.object({ nonconformityId: z.string().min(1), newAssigneeUserId: z.string().min(1) })).optional().default([]),
});

// ---------------------------------------------------------------------------
// Kullanıcı silme yerine arşivleme. İki mod:
// - EXIT (çıkış): kullanıcı bir çalışana bağlıysa (employeeId), o çalışan kaydı da (mevcut
//   çıkış/arşiv akışıyla aynı şekilde) endDate girilerek arşive alınır - bkz.
//   PATCH /employees/:id. Geçmiş uygunsuzluk/kayıtlar SİLİNMEZ.
// - ROLE_CHANGE (görev değişikliği): yalnızca kullanıcı hesabı pasifleştirilir, proje
//   atamaları deaktive edilir ve yetkileri kaldırılır; bağlı çalışan kaydına dokunulmaz
//   (kişi sahada çalışmaya devam ediyor, yalnızca sistem kullanıcısı olmaktan çıkıyor).
// Her iki modda da hesap KALICI OLARAK SİLİNMEZ (isActive=false) - geçmiş
// açtığı/kapattığı uygunsuzluk kayıtlarındaki referanslar bozulmaz.
// ---------------------------------------------------------------------------
router.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    const parsed = archiveUserSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());
    if (req.params.id === req.user.sub) throw ApiError.badRequest('Kendi hesabınızı arşivleyemezsiniz.');

    const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    if (!user) throw ApiError.notFound('Kullanıcı bulunamadı.');
    if (!user.isActive) throw ApiError.conflict('Bu kullanıcı zaten pasif/arşivde.');

    if (parsed.data.mode === 'EXIT' && !user.employeeId) {
      throw ApiError.badRequest('Bu kullanıcı bir çalışan kaydına bağlı değil, çıkış işlemi yapılamaz. Görev değişikliği seçeneğini kullanın.');
    }

    await db.transaction(async (tx) => {
      for (const r of parsed.data.reassignments) {
        await tx
          .delete(nonconformityAssignees)
          .where(and(eq(nonconformityAssignees.nonconformityId, r.nonconformityId), eq(nonconformityAssignees.userId, user.id)));
        await tx
          .insert(nonconformityAssignees)
          .values({ nonconformityId: r.nonconformityId, userId: r.newAssigneeUserId })
          .onConflictDoNothing();
      }

      await tx.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, user.id));
      await tx.update(userProjects).set({ isActive: false }).where(eq(userProjects.userId, user.id));
      await tx.delete(userPermissions).where(eq(userPermissions.userId, user.id));

      if (parsed.data.mode === 'EXIT') {
        const endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : new Date();
        await tx.update(employees).set({ endDate, isActive: false }).where(eq(employees.id, user.employeeId));
      }
    });

    await logAudit({
      userId: req.user.sub,
      action: 'USER_ARCHIVE',
      entityType: 'user',
      entityId: user.id,
      details: { mode: parsed.data.mode, reassignedCount: parsed.data.reassignments.length },
      ipAddress: req.ip,
    });
    if (parsed.data.mode === 'EXIT') {
      await logAudit({
        userId: req.user.sub,
        action: 'EMPLOYEE_ARCHIVE',
        entityType: 'employee',
        entityId: user.employeeId,
        details: { viaUserArchive: true },
        ipAddress: req.ip,
      });
    }

    res.json({ success: true, mode: parsed.data.mode });
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

/**
 * Davet bağlantısı oluşturur: kullanıcı şifresini kendisi belirlesin diye tek kullanımlık,
 * 7 gün geçerli bir link üretilir. Admin bu linki (ör. WhatsApp üzerinden) kullanıcıya iletir.
 * Ham token yalnızca bu yanıtta döner; DB'de sadece hash'i saklanır.
 */
router.post(
  '/:id/invite-link',
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    if (!user) throw ApiError.notFound('Kullanıcı bulunamadı.');
    if (!user.isActive) throw ApiError.badRequest('Pasif kullanıcı için davet bağlantısı oluşturulamaz.');

    const token = crypto.randomBytes(24).toString('base64url');
    const tokenHash = hashInviteToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    await db.insert(userInvites).values({ userId: user.id, tokenHash, expiresAt });

    await logAudit({ userId: req.user.sub, action: 'USER_INVITE_LINK_CREATED', entityType: 'user', entityId: user.id, ipAddress: req.ip });

    res.json({
      token,
      expiresAt,
      username: user.username,
      fullName: user.fullName,
      whatsappPhone: normalizePhoneForWhatsapp(user.phone),
    });
  })
);

const assignProjectSchema = z.object({
  projectId: z.string().min(1),
  roleId: z.string().min(1),
  // Boş/undefined ise atama tüm proje kapsamındadır (Ana Firma / Genel).
  // Doluysa atama yalnızca belirtilen firmaya özeldir.
  companyId: z.string().min(1).optional().nullable(),
  // Boş/undefined ise atama tüm bölgeleri kapsar. Doluysa atama yalnızca belirtilen bölgeye özeldir.
  blockId: z.string().min(1).optional().nullable(),
});

router.post(
  '/:id/projects',
  asyncHandler(async (req, res) => {
    const parsed = assignProjectSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());

    const companyId = parsed.data.companyId || null;
    const blockId = parsed.data.blockId || null;

    if (companyId) {
      const [company] = await db
        .select()
        .from(companies)
        .where(and(eq(companies.id, companyId), eq(companies.projectId, parsed.data.projectId)))
        .limit(1);
      if (!company) throw ApiError.badRequest('Firma bu projeye ait değil.');
    }

    if (blockId) {
      const [block] = await db
        .select()
        .from(projectBlocks)
        .where(and(eq(projectBlocks.id, blockId), eq(projectBlocks.projectId, parsed.data.projectId)))
        .limit(1);
      if (!block) throw ApiError.badRequest('Bölge bu projeye ait değil.');
    }

    const duplicate = await db
      .select()
      .from(userProjects)
      .where(
        and(
          eq(userProjects.userId, req.params.id),
          eq(userProjects.projectId, parsed.data.projectId),
          eq(userProjects.roleId, parsed.data.roleId),
          companyId ? eq(userProjects.companyId, companyId) : isNull(userProjects.companyId),
          blockId ? eq(userProjects.blockId, blockId) : isNull(userProjects.blockId)
        )
      )
      .limit(1);
    if (duplicate.length > 0) throw ApiError.conflict('Bu kullanıcı bu proje/görev/firma/bölge kombinasyonuna zaten atanmış.');

    const [created] = await db
      .insert(userProjects)
      .values({ userId: req.params.id, projectId: parsed.data.projectId, roleId: parsed.data.roleId, companyId, blockId })
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
