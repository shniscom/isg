const express = require('express');
const { z } = require('zod');
const { eq, desc } = require('drizzle-orm');
const { db } = require('../../db/client');
const { companyDocuments, companies } = require('../../db/schema');
const { requirePermission } = require('../../middleware/permission');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { logAudit } = require('../../utils/audit');
const { createViewUrl } = require('../../services/storage.service');

const router = express.Router();
router.use(requirePermission('firma_yonetme'));

const DOC_TYPES = ['RISK_ANALIZI', 'ACIL_DURUM_EYLEM_PLANI'];

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const baseSchema = z.object({
  companyId: z.string().min(1),
  docType: z.enum(DOC_TYPES),
  preparedDate: z.string().optional().nullable(),
  approved: z.boolean().optional().default(false),
  approvedDate: z.string().optional().nullable(),
  validUntil: z.string().optional().nullable(),
  fileObjectKey: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateSchema = baseSchema.partial().omit({ companyId: true });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId } = req.query;
    if (!companyId) throw ApiError.badRequest('companyId zorunludur.');
    const rows = await db.select().from(companyDocuments).where(eq(companyDocuments.companyId, companyId)).orderBy(desc(companyDocuments.createdAt));
    const withUrls = await Promise.all(
      rows.map(async (d) => ({ ...d, fileViewUrl: d.fileObjectKey ? await createViewUrl(d.fileObjectKey).catch(() => null) : null }))
    );
    res.json({ documents: withUrls });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = baseSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz belge bilgisi.', parsed.error.flatten());
    const data = parsed.data;

    const [company] = await db.select().from(companies).where(eq(companies.id, data.companyId)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');

    const [created] = await db
      .insert(companyDocuments)
      .values({
        companyId: data.companyId,
        docType: data.docType,
        preparedDate: toDateOrNull(data.preparedDate),
        approved: data.approved ?? false,
        approvedDate: toDateOrNull(data.approvedDate),
        validUntil: toDateOrNull(data.validUntil),
        fileObjectKey: data.fileObjectKey || null,
        notes: data.notes || null,
        createdById: req.user.sub,
      })
      .returning();

    await logAudit({ userId: req.user.sub, action: 'COMPANY_DOCUMENT_CREATE', entityType: 'company_document', entityId: created.id, details: { docType: data.docType, companyId: data.companyId }, ipAddress: req.ip });
    res.status(201).json({ document: created });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz belge bilgisi.', parsed.error.flatten());
    const data = parsed.data;

    const patch = { ...data };
    if ('preparedDate' in patch) patch.preparedDate = toDateOrNull(patch.preparedDate);
    if ('approvedDate' in patch) patch.approvedDate = toDateOrNull(patch.approvedDate);
    if ('validUntil' in patch) patch.validUntil = toDateOrNull(patch.validUntil);

    const [updated] = await db.update(companyDocuments).set(patch).where(eq(companyDocuments.id, req.params.id)).returning();
    if (!updated) throw ApiError.notFound('Kayıt bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'COMPANY_DOCUMENT_UPDATE', entityType: 'company_document', entityId: updated.id, details: data, ipAddress: req.ip });
    res.json({ document: updated });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [deleted] = await db.delete(companyDocuments).where(eq(companyDocuments.id, req.params.id)).returning();
    if (!deleted) throw ApiError.notFound('Kayıt bulunamadı.');
    await logAudit({ userId: req.user.sub, action: 'COMPANY_DOCUMENT_DELETE', entityType: 'company_document', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
