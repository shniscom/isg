const express = require('express');
const { z } = require('zod');
const { db } = require('../../db/client');
const { companies, companyUsers, users } = require('../../db/schema');
const { eq, and } = require('drizzle-orm');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requirePermission } = require('../../middleware/permission');
const { logAudit } = require('../../utils/audit');

const router = express.Router();
router.use(requirePermission('firma_yonetme'));

const COMPANY_TYPES = ['ANA_FIRMA', 'ALT_ISVEREN', 'TASERON', 'UCUNCU_SAHIS_HIZMET_VEREN', 'TEDARIKCI', 'DIGER'];

const companySchema = z.object({
  projectId: z.string().min(1, 'Proje seçilmelidir.'),
  name: z.string().min(2, 'Firma adı en az 2 karakter olmalıdır.'),
  taxNumber: z.string().optional().nullable(),
  sgkNumber: z.string().optional().nullable(),
  type: z.enum(COMPANY_TYPES).default('DIGER'),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  scopeOfWork: z.string().optional().nullable(),
  responsibleBlockId: z.string().optional().nullable(),
});

const companyUpdateSchema = companySchema.partial().omit({ projectId: true });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const rows = projectId
      ? await db.select().from(companies).where(eq(companies.projectId, projectId))
      : await db.select().from(companies);
    res.json({ companies: rows });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = companySchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz firma bilgisi.', parsed.error.flatten());

    const [created] = await db.insert(companies).values(parsed.data).returning();
    await logAudit({ userId: req.user.sub, action: 'COMPANY_CREATE', entityType: 'company', entityId: created.id, details: parsed.data, ipAddress: req.ip });
    res.status(201).json({ company: created });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [company] = await db.select().from(companies).where(eq(companies.id, req.params.id)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');

    const reps = await db
      .select({
        id: companyUsers.id,
        userId: companyUsers.userId,
        title: companyUsers.title,
        fullName: users.fullName,
        phone: users.phone,
        email: users.email,
      })
      .from(companyUsers)
      .innerJoin(users, eq(companyUsers.userId, users.id))
      .where(eq(companyUsers.companyId, company.id));

    res.json({ company, representatives: reps });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = companyUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz firma bilgisi.', parsed.error.flatten());

    const [updated] = await db
      .update(companies)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(companies.id, req.params.id))
      .returning();
    if (!updated) throw ApiError.notFound('Firma bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'COMPANY_UPDATE', entityType: 'company', entityId: updated.id, details: parsed.data, ipAddress: req.ip });
    res.json({ company: updated });
  })
);

// Firmalar kalıcı silinmez; pasif duruma alınır (soft delete).
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [updated] = await db
      .update(companies)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(companies.id, req.params.id))
      .returning();
    if (!updated) throw ApiError.notFound('Firma bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'COMPANY_DEACTIVATE', entityType: 'company', entityId: updated.id, ipAddress: req.ip });
    res.json({ company: updated });
  })
);

const addRepSchema = z.object({
  userId: z.string().min(1),
  title: z.string().optional().nullable(),
});

router.post(
  '/:id/users',
  asyncHandler(async (req, res) => {
    const parsed = addRepSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());

    const [company] = await db.select().from(companies).where(eq(companies.id, req.params.id)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');

    const duplicate = await db
      .select()
      .from(companyUsers)
      .where(and(eq(companyUsers.companyId, req.params.id), eq(companyUsers.userId, parsed.data.userId)))
      .limit(1);
    if (duplicate.length > 0) throw ApiError.conflict('Bu kullanıcı zaten bu firmanın yetkilisi.');

    const [created] = await db
      .insert(companyUsers)
      .values({ companyId: req.params.id, userId: parsed.data.userId, title: parsed.data.title })
      .returning();

    await logAudit({ userId: req.user.sub, action: 'COMPANY_USER_ADD', entityType: 'company_user', entityId: created.id, details: parsed.data, ipAddress: req.ip });
    res.status(201).json({ representative: created });
  })
);

router.delete(
  '/:id/users/:companyUserId',
  asyncHandler(async (req, res) => {
    const [deleted] = await db
      .delete(companyUsers)
      .where(and(eq(companyUsers.id, req.params.companyUserId), eq(companyUsers.companyId, req.params.id)))
      .returning();
    if (!deleted) throw ApiError.notFound('Kayıt bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'COMPANY_USER_REMOVE', entityType: 'company_user', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
