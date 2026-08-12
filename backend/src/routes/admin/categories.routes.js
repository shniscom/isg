const express = require('express');
const { z } = require('zod');
const { db } = require('../../db/client');
const { categories } = require('../../db/schema');
const { eq } = require('drizzle-orm');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requireSystemAdmin } = require('../../middleware/permission');
const { logAudit } = require('../../utils/audit');

const router = express.Router();
router.use(requireSystemAdmin);

const categorySchema = z.object({
  projectId: z.string().optional().nullable(),
  name: z.string().min(2, 'Kategori adı en az 2 karakter olmalıdır.'),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const rows = projectId
      ? await db.select().from(categories).where(eq(categories.projectId, projectId))
      : await db.select().from(categories);
    res.json({ categories: rows });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz kategori bilgisi.', parsed.error.flatten());

    const [created] = await db.insert(categories).values(parsed.data).returning();
    await logAudit({ userId: req.user.sub, action: 'CATEGORY_CREATE', entityType: 'category', entityId: created.id, details: parsed.data, ipAddress: req.ip });
    res.status(201).json({ category: created });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = categorySchema.partial().safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz kategori bilgisi.', parsed.error.flatten());

    const [updated] = await db.update(categories).set(parsed.data).where(eq(categories.id, req.params.id)).returning();
    if (!updated) throw ApiError.notFound('Kategori bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'CATEGORY_UPDATE', entityType: 'category', entityId: updated.id, details: parsed.data, ipAddress: req.ip });
    res.json({ category: updated });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [updated] = await db
      .update(categories)
      .set({ isActive: false })
      .where(eq(categories.id, req.params.id))
      .returning();
    if (!updated) throw ApiError.notFound('Kategori bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'CATEGORY_DEACTIVATE', entityType: 'category', entityId: updated.id, ipAddress: req.ip });
    res.json({ category: updated });
  })
);

module.exports = router;
