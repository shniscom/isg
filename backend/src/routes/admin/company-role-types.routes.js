const express = require('express');
const { z } = require('zod');
const { eq } = require('drizzle-orm');
const { db } = require('../../db/client');
const { companyRoleTypes, companyRoleAssignments } = require('../../db/schema');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requirePermission } = require('../../middleware/permission');
const { logAudit } = require('../../utils/audit');

/**
 * Firma rolü tipi kataloğu (İşveren, Şantiye Şefi, İSG Uzmanı, İlkyardımcı vb.). "Görevler"
 * sayfasındaki "Firma Rolleri" bölümü buradan yönetilir; buradaki bir kayıt CompanyDetailPage'in
 * "Roller & Ekipler" sekmesindeki dropdown'a ve company_role_assignments.roleType alanına FK
 * üzerinden bağlıdır. Görüntüleme (Görevler sayfasını açabilen) kullanıcı_yonetme yetkisiyle
 * aynı sayfada yönetilir; ayrı bir izin tanımlamaya gerek görülmedi çünkü bu liste zaten
 * "Görevler" admin sayfasının bir parçası.
 */
const router = express.Router();

// Katalog kaydı ekleme/düzenleme/silme (Görevler sayfası) yalnızca kullanici_yonetme gerektirir.
// Ancak listeyi GÖRÜNTÜLEME (GET) - firma detayındaki "Roller" sekmesinde İSG uzmanı/işyeri
// hekimi/DSP dropdown'ını doldurmak için - firma_yonetme/firma_goruntuleme/gecici_gorevlendirme_
// yonetimi yetkilerinden biriyle de mümkün olmalı; aksi halde bu kullanıcılar rol tipi listesini
// hiç göremez ve Roller sekmesindeki rol seçim kutusu boş kalır (bkz. company-roles.routes.js).
const VIEW_PERMISSIONS = ['kullanici_yonetme', 'firma_yonetme', 'firma_goruntuleme', 'gecici_gorevlendirme_yonetimi'];

const CATEGORIES = ['FIRMA_ROLU', 'ACIL_EKIP'];

const createSchema = z.object({
  key: z
    .string()
    .min(2, 'Anahtar en az 2 karakter olmalıdır.')
    .regex(/^[A-Z0-9_]+$/, 'Anahtar yalnızca büyük harf, rakam ve alt çizgi içerebilir.'),
  label: z.string().min(2, 'Rol adı en az 2 karakter olmalıdır.'),
  category: z.enum(CATEGORIES).default('FIRMA_ROLU'),
  sortOrder: z.number().int().optional(),
});

router.get(
  '/',
  requirePermission(VIEW_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(companyRoleTypes).orderBy(companyRoleTypes.category, companyRoleTypes.sortOrder, companyRoleTypes.label);
    res.json({ roleTypes: rows });
  })
);

router.post(
  '/',
  requirePermission('kullanici_yonetme'),
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz firma rolü bilgisi.', parsed.error.flatten());

    const existing = await db.select().from(companyRoleTypes).where(eq(companyRoleTypes.key, parsed.data.key)).limit(1);
    if (existing.length > 0) throw ApiError.conflict('Bu anahtara sahip bir firma rolü zaten mevcut.');

    const [created] = await db
      .insert(companyRoleTypes)
      .values({
        key: parsed.data.key,
        label: parsed.data.label,
        category: parsed.data.category,
        sortOrder: parsed.data.sortOrder ?? 0,
      })
      .returning();

    await logAudit({ userId: req.user.sub, action: 'COMPANY_ROLE_TYPE_CREATE', entityType: 'company_role_type', entityId: created.id, details: parsed.data, ipAddress: req.ip });
    res.status(201).json({ roleType: created });
  })
);

router.patch(
  '/:id',
  requirePermission('kullanici_yonetme'),
  asyncHandler(async (req, res) => {
    const parsed = createSchema.omit({ key: true }).partial().safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz firma rolü bilgisi.', parsed.error.flatten());

    const [updated] = await db.update(companyRoleTypes).set(parsed.data).where(eq(companyRoleTypes.id, req.params.id)).returning();
    if (!updated) throw ApiError.notFound('Firma rolü bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'COMPANY_ROLE_TYPE_UPDATE', entityType: 'company_role_type', entityId: updated.id, details: parsed.data, ipAddress: req.ip });
    res.json({ roleType: updated });
  })
);

router.delete(
  '/:id',
  requirePermission('kullanici_yonetme'),
  asyncHandler(async (req, res) => {
    const [existing] = await db.select().from(companyRoleTypes).where(eq(companyRoleTypes.id, req.params.id)).limit(1);
    if (!existing) throw ApiError.notFound('Firma rolü bulunamadı.');

    const inUse = await db.select().from(companyRoleAssignments).where(eq(companyRoleAssignments.roleType, existing.key)).limit(1);
    if (inUse.length > 0) {
      throw ApiError.conflict('Bu firma rolü firmalara atanmış durumda, silinemez. Önce atamaları kaldırın.');
    }

    const [deleted] = await db.delete(companyRoleTypes).where(eq(companyRoleTypes.id, req.params.id)).returning();

    await logAudit({ userId: req.user.sub, action: 'COMPANY_ROLE_TYPE_DELETE', entityType: 'company_role_type', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
