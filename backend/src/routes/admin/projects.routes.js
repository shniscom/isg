const express = require('express');
const { z } = require('zod');
const { db } = require('../../db/client');
const { projects, projectBlocks, nonconformities } = require('../../db/schema');
const { eq, and, ne, count } = require('drizzle-orm');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requirePermission, requireSystemAdmin } = require('../../middleware/permission');
const { logAudit } = require('../../utils/audit');
const { runOrQueueForApproval } = require('../../utils/approval');

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

// Proje bilgisi değişikliği (ad/kod/adres vb.) kritik/geri dönülmez sayılır (bkz. utils/approval.js):
// admin anında uygular, admin olmayan biri isterse istek admin onayına kuyruğa alınır ve
// yalnızca onaylanırsa services/criticalActions.service.js -> PROJECT_UPDATE üzerinden uygulanır.
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = projectUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz proje bilgisi.', parsed.error.flatten());

    const [existing] = await db.select().from(projects).where(eq(projects.id, req.params.id)).limit(1);
    if (!existing) throw ApiError.notFound('Proje bulunamadı.');

    // Hızlı geri bildirim için ön kontrol; asıl/otoriter kontrol executor içinde tekrar yapılır
    // (onay bekleyen istek ile admin'in onayladığı an arasında başka bir proje aynı kodu almış olabilir).
    if (parsed.data.code && parsed.data.code !== existing.code) {
      const duplicate = await db
        .select()
        .from(projects)
        .where(and(eq(projects.code, parsed.data.code), ne(projects.id, req.params.id)))
        .limit(1);
      if (duplicate.length > 0) throw ApiError.conflict('Bu proje kodu başka bir projede zaten kullanımda.');
    }

    await runOrQueueForApproval(req, res, {
      actionType: 'PROJECT_UPDATE',
      entityType: 'project',
      entityId: existing.id,
      payload: { projectId: existing.id, data: parsed.data },
      summary: `"${existing.name}" projesinin bilgileri güncellenecek${parsed.data.code && parsed.data.code !== existing.code ? ` (kod: "${existing.code}" → "${parsed.data.code}")` : ''}.`,
      projectId: existing.id,
    });
  })
);

router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const schema = z.object({ status: z.enum(['AKTIF', 'PASIF']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz durum.', parsed.error.flatten());

    const [existing] = await db.select().from(projects).where(eq(projects.id, req.params.id)).limit(1);
    if (!existing) throw ApiError.notFound('Proje bulunamadı.');

    await runOrQueueForApproval(req, res, {
      actionType: 'PROJECT_STATUS_CHANGE',
      entityType: 'project',
      entityId: existing.id,
      payload: { projectId: existing.id, status: parsed.data.status },
      summary: `"${existing.name}" projesi ${parsed.data.status === 'PASIF' ? 'pasife alınacak' : 'aktife alınacak'}.`,
      projectId: existing.id,
    });
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

/**
 * Projeyi test/deneme sürecinde sıfırlar: bu projeye ait TÜM uygunsuzluklar (ve bağlı
 * fotoğraf/düzeltme/tarihçe/ceza kayıtları, cascade ile) kalıcı olarak silinir. Proje, firma,
 * kullanıcı ve rol tanımlarına dokunulmaz. Yanlışlıkla tetiklenmesini önlemek için istek
 * gövdesinde projenin kodunun aynen tekrar yazılması zorunludur.
 * Yalnızca sistem admini kullanabilir (proje_yonetme yetkisi yeterli değildir).
 */
router.post(
  '/:id/reset-nonconformities',
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.id)).limit(1);
    if (!project) throw ApiError.notFound('Proje bulunamadı.');

    const schema = z.object({ confirmCode: z.string().min(1, 'Onay için proje kodunu yazmalısınız.') });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Onay için proje kodunu yazmalısınız.');
    if (parsed.data.confirmCode !== project.code) {
      throw ApiError.badRequest('Girilen proje kodu eşleşmiyor. Sıfırlama iptal edildi.');
    }

    const [{ value: totalBefore }] = await db.select({ value: count() }).from(nonconformities).where(eq(nonconformities.projectId, project.id));

    await db.delete(nonconformities).where(eq(nonconformities.projectId, project.id));

    await logAudit({
      userId: req.user.sub,
      action: 'PROJECT_RESET_NONCONFORMITIES',
      entityType: 'project',
      entityId: project.id,
      details: { deletedCount: totalBefore },
      ipAddress: req.ip,
    });

    res.json({ success: true, deletedCount: totalBefore });
  })
);

module.exports = router;
