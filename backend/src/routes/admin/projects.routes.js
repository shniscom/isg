const express = require('express');
const { z } = require('zod');
const { db } = require('../../db/client');
const { projects, projectBlocks } = require('../../db/schema');
const { eq, and } = require('drizzle-orm');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requirePermission } = require('../../middleware/permission');
const { logAudit } = require('../../utils/audit');

const router = express.Router();
router.use(requirePermission('proje_yonetme'));

const projectSchema = z.object({
  name: z.string().min(2, 'Proje adı en az 2 karakter olmalıdır.'),
  code: z.string().min(2, 'Proje kodu en az 2 karakter olmalıdır.'),
  address: z.string().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  plannedEndDate: z.string().datetime().optional().nullable(),
  employer: z.string().optional().nullable(),
});

const projectUpdateSchema = projectSchema.partial();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(projects).orderBy(projects.createdAt);
    res.json({ projects: rows });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz proje bilgisi.', parsed.error.flatten());

    const existing = await db.select().from(projects).where(eq(projects.code, parsed.data.code)).limit(1);
    if (existing.length > 0) throw ApiError.conflict('Bu proje kodu zaten kullanımda.');

    const [created] = await db.insert(projects).values(parsed.data).returning();
    await logAudit({ userId: req.user.sub, action: 'PROJECT_CREATE', entityType: 'project', entityId: created.id, details: parsed.data, ipAddress: req.ip });
    res.status(201).json({ project: created });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.id)).limit(1);
    if (!project) throw ApiError.notFound('Proje bulunamadı.');
    const blocks = await db.select().from(projectBlocks).where(eq(projectBlocks.projectId, project.id));
    res.json({ project, blocks });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = projectUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz proje bilgisi.', parsed.error.flatten());

    const [existing] = await db.select().from(projects).where(eq(projects.id, req.params.id)).limit(1);
    if (!existing) throw ApiError.notFound('Proje bulunamadı.');

    const [updated] = await db
      .update(projects)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(projects.id, req.params.id))
      .returning();

    await logAudit({ userId: req.user.sub, action: 'PROJECT_UPDATE', entityType: 'project', entityId: updated.id, details: parsed.data, ipAddress: req.ip });
    res.json({ project: updated });
  })
);

router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const schema = z.object({ status: z.enum(['AKTIF', 'PASIF']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz durum.', parsed.error.flatten());

    const [updated] = await db
      .update(projects)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(projects.id, req.params.id))
      .returning();
    if (!updated) throw ApiError.notFound('Proje bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'PROJECT_STATUS_CHANGE', entityType: 'project', entityId: updated.id, details: parsed.data, ipAddress: req.ip });
    res.json({ project: updated });
  })
);

router.get(
  '/:id/blocks',
  asyncHandler(async (req, res) => {
    const blocks = await db.select().from(projectBlocks).where(eq(projectBlocks.projectId, req.params.id));
    res.json({ blocks });
  })
);

router.post(
  '/:id/blocks',
  asyncHandler(async (req, res) => {
    const schema = z.object({ name: z.string().min(1, 'Blok/bölge adı zorunludur.') });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz blok bilgisi.', parsed.error.flatten());

    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.id)).limit(1);
    if (!project) throw ApiError.notFound('Proje bulunamadı.');

    const duplicate = await db
      .select()
      .from(projectBlocks)
      .where(and(eq(projectBlocks.projectId, req.params.id), eq(projectBlocks.name, parsed.data.name)))
      .limit(1);
    if (duplicate.length > 0) throw ApiError.conflict('Bu isimde bir blok/bölge zaten mevcut.');

    const [created] = await db
      .insert(projectBlocks)
      .values({ projectId: req.params.id, name: parsed.data.name })
      .returning();

    await logAudit({ userId: req.user.sub, action: 'PROJECT_BLOCK_CREATE', entityType: 'project_block', entityId: created.id, details: parsed.data, ipAddress: req.ip });
    res.status(201).json({ block: created });
  })
);

router.patch(
  '/:id/blocks/:blockId',
  asyncHandler(async (req, res) => {
    const schema = z.object({ name: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz blok bilgisi.', parsed.error.flatten());

    const [updated] = await db
      .update(projectBlocks)
      .set({ name: parsed.data.name })
      .where(and(eq(projectBlocks.id, req.params.blockId), eq(projectBlocks.projectId, req.params.id)))
      .returning();
    if (!updated) throw ApiError.notFound('Blok/bölge bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'PROJECT_BLOCK_UPDATE', entityType: 'project_block', entityId: updated.id, details: parsed.data, ipAddress: req.ip });
    res.json({ block: updated });
  })
);

router.delete(
  '/:id/blocks/:blockId',
  asyncHandler(async (req, res) => {
    const [deleted] = await db
      .delete(projectBlocks)
      .where(and(eq(projectBlocks.id, req.params.blockId), eq(projectBlocks.projectId, req.params.id)))
      .returning();
    if (!deleted) throw ApiError.notFound('Blok/bölge bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'PROJECT_BLOCK_DELETE', entityType: 'project_block', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
