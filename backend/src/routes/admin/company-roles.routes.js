const express = require('express');
const { z } = require('zod');
const { eq, and, inArray } = require('drizzle-orm');
const { db } = require('../../db/client');
const { companyRoleAssignments, companyRoleTypes, companies, employees } = require('../../db/schema');
const { requirePermission } = require('../../middleware/permission');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { logAudit } = require('../../utils/audit');

const router = express.Router();

// GET / (bir firmanın rol atamalarını listeleme) yalnızca firma yönetim yetkilileriyle sınırlı
// değil: çalışan ekleme/düzenleme yetkisi olan (insan_kaynaklari_yonetimi/uygunsuzluk_acma)
// kullanıcılar da bu listeyi görebilmeli - aksi halde çalışan formundaki "eğitimi veren İSG
// uzmanı/işyeri hekimi/DSP" seçim kutusu onlar için hep boş kalır (bkz. EmployeesPage.jsx /
// EmployeeDetailPage.jsx RoleAssignmentSelect kullanımı).
const VIEW_PERMISSIONS = ['firma_yonetme', 'firma_goruntuleme', 'gecici_gorevlendirme_yonetimi', 'insan_kaynaklari_yonetimi', 'uygunsuzluk_acma'];
// Firma rol atamalarını (İSG uzmanı/işyeri hekimi/DSP vb.) düzenleme normalde yalnızca
// 'firma_yonetme' gerektirir. Ancak geçici görevlendirme firmaları (companies.isTemporaryAssignment
// =true) için 'gecici_gorevlendirme_yonetimi' yetkisi de yeterlidir - admin/companies.routes.js'deki
// WRITE_PERMISSIONS dallanma deseniyle aynı mantık (bkz. o dosyadaki yorum).
const WRITE_PERMISSIONS = ['firma_yonetme', 'gecici_gorevlendirme_yonetimi'];

function hasPermission(req, key) {
  return req.user.isSystemAdmin || (req.user.permissions || []).includes(key);
}

function assertCanWrite(req, company) {
  if (hasPermission(req, 'firma_yonetme')) return;
  if (company.isTemporaryAssignment && hasPermission(req, 'gecici_gorevlendirme_yonetimi')) return;
  throw ApiError.forbidden('Yalnızca geçici görevlendirme firmalarının rol atamalarını düzenleme yetkiniz var.');
}

// Firma rolü tipleri artık sabit bir liste değil, admin tarafından "Görevler" sayfasından
// yönetilen company_role_types tablosudur (bkz. company-role-types.routes.js). İşveren ve
// İşveren Vekili firmanın kendi tüzel/gerçek kişisi olduğu için çalışan listesinde bulunması
// zorunlu değildir; bu iki anahtar özel olarak sabit tutuldu çünkü iş kuralı bu spesifik
// rollere bağlı (yeni eklenen özel roller için varsayılan olarak çalışan seçimi zorunludur).
const EMPLOYEE_NOT_REQUIRED_ROLE_KEYS = new Set(['ISVEREN', 'ISVEREN_VEKILI']);

/**
 * Bir çalışanın employees.isgRole alanını, o çalışana atanmış (source=CALISAN) tüm firma
 * rollerinden yeniden hesaplar ve günceller. Roller & Ekipler sekmesinden çalışan listesinden
 * seçilerek bir kişiye rol atandığında/kaldırıldığında, bu rol otomatik olarak Çalışanlar
 * sekmesindeki "İSG Görevi" rozetine ve filtresine de yansısın diye POST/DELETE sonrası çağrılır.
 */
async function syncEmployeeIsgRole(employeeId) {
  if (!employeeId) return;
  const assignments = await db
    .select({ roleType: companyRoleAssignments.roleType })
    .from(companyRoleAssignments)
    .where(and(eq(companyRoleAssignments.employeeId, employeeId), eq(companyRoleAssignments.source, 'CALISAN')));
  if (assignments.length === 0) {
    await db.update(employees).set({ isgRole: null }).where(eq(employees.id, employeeId));
    return;
  }
  const keys = [...new Set(assignments.map((a) => a.roleType))];
  const typeRows = await db.select({ key: companyRoleTypes.key, label: companyRoleTypes.label }).from(companyRoleTypes).where(inArray(companyRoleTypes.key, keys));
  const labelByKey = new Map(typeRows.map((t) => [t.key, t.label]));
  const labels = keys.map((k) => labelByKey.get(k) || k);
  await db.update(employees).set({ isgRole: labels.join(', ') }).where(eq(employees.id, employeeId));
}

const createSchema = z
  .object({
    companyId: z.string().min(1),
    roleType: z.string().min(1, 'Rol seçilmelidir.'),
    source: z.enum(['CALISAN', 'DISARIDAN']).default('CALISAN'),
    employeeId: z.string().optional().nullable(),
    outsideFullName: z.string().optional().nullable(),
    outsideCompanyName: z.string().optional().nullable(),
    outsideNationalId: z.string().optional().nullable(),
    outsidePhone: z.string().optional().nullable(),
    certificateNo: z.string().optional().nullable(),
    certificateClass: z.string().optional().nullable(),
    certificateStartDate: z.string().optional().nullable(),
    certificateEndDate: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.source === 'CALISAN' && !data.employeeId && !EMPLOYEE_NOT_REQUIRED_ROLE_KEYS.has(data.roleType)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bu rol için çalışan listesinden bir kişi seçilmelidir.', path: ['employeeId'] });
    }
    if (data.source === 'DISARIDAN' && !data.outsideFullName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Dışarıdan kişi için ad soyad girilmelidir.', path: ['outsideFullName'] });
    }
  });

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

router.get(
  '/',
  requirePermission(VIEW_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const { companyId } = req.query;
    if (!companyId) throw ApiError.badRequest('companyId zorunludur.');
    const rows = await db
      .select({
        id: companyRoleAssignments.id,
        companyId: companyRoleAssignments.companyId,
        roleType: companyRoleAssignments.roleType,
        source: companyRoleAssignments.source,
        employeeId: companyRoleAssignments.employeeId,
        employeeFullName: employees.fullName,
        outsideFullName: companyRoleAssignments.outsideFullName,
        outsideCompanyName: companyRoleAssignments.outsideCompanyName,
        outsideNationalId: companyRoleAssignments.outsideNationalId,
        outsidePhone: companyRoleAssignments.outsidePhone,
        certificateNo: companyRoleAssignments.certificateNo,
        certificateClass: companyRoleAssignments.certificateClass,
        certificateStartDate: companyRoleAssignments.certificateStartDate,
        certificateEndDate: companyRoleAssignments.certificateEndDate,
        notes: companyRoleAssignments.notes,
        createdAt: companyRoleAssignments.createdAt,
      })
      .from(companyRoleAssignments)
      .leftJoin(employees, eq(companyRoleAssignments.employeeId, employees.id))
      .where(eq(companyRoleAssignments.companyId, companyId));
    res.json({ roles: rows });
  })
);

router.post(
  '/',
  requirePermission(WRITE_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz rol bilgisi.', parsed.error.flatten());
    const data = parsed.data;

    const [company] = await db.select().from(companies).where(eq(companies.id, data.companyId)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');
    assertCanWrite(req, company);

    const [roleTypeRow] = await db.select().from(companyRoleTypes).where(eq(companyRoleTypes.key, data.roleType)).limit(1);
    if (!roleTypeRow) throw ApiError.badRequest('Geçersiz rol tipi.');

    if (data.source === 'CALISAN' && data.employeeId) {
      const [employee] = await db.select().from(employees).where(eq(employees.id, data.employeeId)).limit(1);
      if (!employee || employee.companyId !== data.companyId) {
        throw ApiError.badRequest('Seçilen çalışan bu firmaya ait değil.');
      }
    }

    const [created] = await db
      .insert(companyRoleAssignments)
      .values({
        companyId: data.companyId,
        roleType: data.roleType,
        source: data.source,
        employeeId: data.source === 'CALISAN' ? data.employeeId || null : null,
        outsideFullName: data.source === 'DISARIDAN' ? data.outsideFullName || null : null,
        outsideCompanyName: data.source === 'DISARIDAN' ? data.outsideCompanyName || null : null,
        outsideNationalId: data.source === 'DISARIDAN' ? data.outsideNationalId || null : null,
        outsidePhone: data.source === 'DISARIDAN' ? data.outsidePhone || null : null,
        certificateNo: data.certificateNo || null,
        certificateClass: data.certificateClass || null,
        certificateStartDate: toDateOrNull(data.certificateStartDate),
        certificateEndDate: toDateOrNull(data.certificateEndDate),
        notes: data.notes || null,
        createdById: req.user.sub,
      })
      .returning();

    if (created.source === 'CALISAN' && created.employeeId) {
      await syncEmployeeIsgRole(created.employeeId);
    }

    await logAudit({ userId: req.user.sub, action: 'COMPANY_ROLE_CREATE', entityType: 'company_role_assignment', entityId: created.id, details: data, ipAddress: req.ip });
    res.status(201).json({ role: created });
  })
);

const patchSchema = z.object({
  outsideFullName: z.string().optional().nullable(),
  outsideCompanyName: z.string().optional().nullable(),
  outsideNationalId: z.string().optional().nullable(),
  outsidePhone: z.string().optional().nullable(),
  certificateNo: z.string().optional().nullable(),
  certificateClass: z.string().optional().nullable(),
  certificateStartDate: z.string().optional().nullable(),
  certificateEndDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Bir rol atamasını düzenler - en tipik kullanımı, görevden ayrılan bir uzman/hekim/DSP için
// "çıkış tarihi" (certificateEndDate) girmektir; böylece kayıt silinmeden geçmişte kalır ve
// yerine yeni bir atama (POST) eklenebilir. companyId/roleType/source/employeeId değiştirilemez
// (bunlar için mevcut kayıt silinip yeniden oluşturulmalı) - PATCH yalnızca kimlik/sertifika/
// tarih/not alanlarını günceller.
router.patch(
  '/:id',
  requirePermission(WRITE_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz rol bilgisi.', parsed.error.flatten());

    const [existing] = await db.select().from(companyRoleAssignments).where(eq(companyRoleAssignments.id, req.params.id)).limit(1);
    if (!existing) throw ApiError.notFound('Kayıt bulunamadı.');
    const [company] = await db.select().from(companies).where(eq(companies.id, existing.companyId)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');
    assertCanWrite(req, company);

    const data = parsed.data;
    const values = {};
    if (existing.source === 'DISARIDAN') {
      if (data.outsideFullName !== undefined) values.outsideFullName = data.outsideFullName || null;
      if (data.outsideCompanyName !== undefined) values.outsideCompanyName = data.outsideCompanyName || null;
      if (data.outsideNationalId !== undefined) values.outsideNationalId = data.outsideNationalId || null;
      if (data.outsidePhone !== undefined) values.outsidePhone = data.outsidePhone || null;
    }
    if (data.certificateNo !== undefined) values.certificateNo = data.certificateNo || null;
    if (data.certificateClass !== undefined) values.certificateClass = data.certificateClass || null;
    if (data.certificateStartDate !== undefined) values.certificateStartDate = toDateOrNull(data.certificateStartDate);
    if (data.certificateEndDate !== undefined) values.certificateEndDate = toDateOrNull(data.certificateEndDate);
    if (data.notes !== undefined) values.notes = data.notes || null;

    const [updated] = await db.update(companyRoleAssignments).set(values).where(eq(companyRoleAssignments.id, req.params.id)).returning();

    await logAudit({ userId: req.user.sub, action: 'COMPANY_ROLE_UPDATE', entityType: 'company_role_assignment', entityId: updated.id, details: values, ipAddress: req.ip });
    res.json({ role: updated });
  })
);

router.delete(
  '/:id',
  requirePermission(WRITE_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const [existing] = await db.select().from(companyRoleAssignments).where(eq(companyRoleAssignments.id, req.params.id)).limit(1);
    if (!existing) throw ApiError.notFound('Kayıt bulunamadı.');
    const [company] = await db.select().from(companies).where(eq(companies.id, existing.companyId)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');
    assertCanWrite(req, company);

    const [deleted] = await db.delete(companyRoleAssignments).where(eq(companyRoleAssignments.id, req.params.id)).returning();
    if (!deleted) throw ApiError.notFound('Kayıt bulunamadı.');

    if (deleted.source === 'CALISAN' && deleted.employeeId) {
      await syncEmployeeIsgRole(deleted.employeeId);
    }

    await logAudit({ userId: req.user.sub, action: 'COMPANY_ROLE_DELETE', entityType: 'company_role_assignment', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
