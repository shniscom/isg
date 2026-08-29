const express = require('express');
const { z } = require('zod');
const { eq } = require('drizzle-orm');
const { db } = require('../../db/client');
const { companyRoleAssignments, companies, employees } = require('../../db/schema');
const { requirePermission } = require('../../middleware/permission');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { logAudit } = require('../../utils/audit');

const router = express.Router();
router.use(requirePermission('firma_yonetme'));

const ROLE_TYPES = [
  'ISVEREN',
  'ISVEREN_VEKILI',
  'SANTIYE_SEFI',
  'CALISAN_TEMSILCISI',
  'DESTEK_PERSONELI',
  'PROJE_MUDURU',
  'ISG_UZMANI',
  'ISYERI_HEKIMI',
  'DIGER_SAGLIK_PERSONELI',
  'ILKYARDIM',
  'ARAMA_KURTARMA',
  'KORUMA',
];

// İşveren ve İşveren Vekili firmanın kendi tüzel/gerçek kişisi olduğu için çalışan listesinde
// bulunması zorunlu değildir; diğer tüm roller (destek personeli, İSG uzmanı, ilkyardımcı vb.)
// firma bünyesindeyse çalışan listesinden seçilmelidir (source=CALISAN). Dışarıdan (OSGB vb.)
// hizmet alınıyorsa source=DISARIDAN ile serbest metin bilgileri girilir.
const EMPLOYEE_NOT_REQUIRED_ROLES = new Set(['ISVEREN', 'ISVEREN_VEKILI']);

const createSchema = z
  .object({
    companyId: z.string().min(1),
    roleType: z.enum(ROLE_TYPES),
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
    if (data.source === 'CALISAN' && !data.employeeId && !EMPLOYEE_NOT_REQUIRED_ROLES.has(data.roleType)) {
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
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz rol bilgisi.', parsed.error.flatten());
    const data = parsed.data;

    const [company] = await db.select().from(companies).where(eq(companies.id, data.companyId)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');

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

    await logAudit({ userId: req.user.sub, action: 'COMPANY_ROLE_CREATE', entityType: 'company_role_assignment', entityId: created.id, details: data, ipAddress: req.ip });
    res.status(201).json({ role: created });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [deleted] = await db.delete(companyRoleAssignments).where(eq(companyRoleAssignments.id, req.params.id)).returning();
    if (!deleted) throw ApiError.notFound('Kayıt bulunamadı.');
    await logAudit({ userId: req.user.sub, action: 'COMPANY_ROLE_DELETE', entityType: 'company_role_assignment', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
