const express = require('express');
const { z } = require('zod');
const { db } = require('../../db/client');
const { roles, userProjects } = require('../../db/schema');
const { eq } = require('drizzle-orm');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requirePermission } = require('../../middleware/permission');
const { logAudit } = require('../../utils/audit');

const router = express.Router();
router.use(requirePermission('kullanici_yonetme'));

const roleSchema = z.object({
  name: z.string().min(2, 'Görev adı en az 2 karakter olmalıdır.'),
  description: z.string().optional().nullable(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(roles).orderBy(roles.name);
    res.json({ roles: rows });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz görev bilgisi.', parsed.error.flatten());

    const existing = await db.select().from(roles).where(eq(roles.name, parsed.data.name)).limit(1);
    if (existing.length > 0) throw ApiError.conflict('Bu isimde bir görev zaten mevcut.');

    const [created] = await db.insert(roles).values(parsed.data).returning();
    await logAudit({ userId: req.user.sub, action: 'ROLE_CREATE', entityType: 'role', entityId: created.id, details: parsed.data, ipAddress: req.ip });
    res.status(201).json({ role: created });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = roleSchema.partial().safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz görev bilgisi.', parsed.error.flatten());

    const [updated] = await db.update(roles).set(parsed.data).where(eq(roles.id, req.params.id)).returning();
    if (!updated) throw ApiError.notFound('Görev bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'ROLE_UPDATE', entityType: 'role', entityId: updated.id, details: parsed.data, ipAddress: req.ip });
    res.json({ role: updated });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const inUse = await db.select().from(userProjects).where(eq(userProjects.roleId, req.params.id)).limit(1);
    if (inUse.length > 0) {
      throw ApiError.conflict('Bu görev kullanıcılara atanmış durumda, silinemez. Önce atamaları kaldırın.');
    }

    const [deleted] = await db.delete(roles).where(eq(roles.id, req.params.id)).returning();
    if (!deleted) throw ApiError.notFound('Görev bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'ROLE_DELETE', entityType: 'role', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
