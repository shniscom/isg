const express = require('express');
const { z } = require('zod');
const { eq, and, desc } = require('drizzle-orm');
const { db } = require('../../db/client');
const { equipment, companies, employees } = require('../../db/schema');
const { requirePermission } = require('../../middleware/permission');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { logAudit } = require('../../utils/audit');

const router = express.Router();
router.use(requirePermission('firma_yonetme'));

const ASSIGNED_TO = ['FIRMA', 'KISI'];
const OPERATOR_SOURCE = ['CALISAN', 'DISARIDAN', 'YOK'];

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const baseSchema = z.object({
  projectId: z.string().min(1),
  companyId: z.string().min(1),
  name: z.string().min(2, 'Ekipman adı zorunludur.'),
  serialNumber: z.string().optional().nullable(),
  licenseNumber: z.string().optional().nullable(),
  periodicInspectionDate: z.string().optional().nullable(),
  periodicInspectionValidUntil: z.string().optional().nullable(),
  hasDamage: z.boolean().optional().default(false),
  damageDescription: z.string().optional().nullable(),
  fitForUse: z.boolean().optional().default(true),
  assignedTo: z.enum(ASSIGNED_TO).optional().default('FIRMA'),
  assignedEmployeeId: z.string().optional().nullable(),
  operatorSource: z.enum(OPERATOR_SOURCE).optional().default('YOK'),
  operatorEmployeeId: z.string().optional().nullable(),
  operatorOutsideFullName: z.string().optional().nullable(),
  operatorOutsideCompanyName: z.string().optional().nullable(),
  operatorOutsideNationalId: z.string().optional().nullable(),
  operatorOutsideSgkNo: z.string().optional().nullable(),
  operatorCertificateNo: z.string().optional().nullable(),
});

const updateSchema = baseSchema.partial().omit({ projectId: true, companyId: true });

const EQUIPMENT_SELECT = {
  id: equipment.id,
  projectId: equipment.projectId,
  companyId: equipment.companyId,
  companyName: companies.name,
  name: equipment.name,
  serialNumber: equipment.serialNumber,
  licenseNumber: equipment.licenseNumber,
  periodicInspectionDate: equipment.periodicInspectionDate,
  periodicInspectionValidUntil: equipment.periodicInspectionValidUntil,
  hasDamage: equipment.hasDamage,
  damageDescription: equipment.damageDescription,
  fitForUse: equipment.fitForUse,
  assignedTo: equipment.assignedTo,
  assignedEmployeeId: equipment.assignedEmployeeId,
  assignedEmployeeName: employees.fullName,
  operatorSource: equipment.operatorSource,
  operatorEmployeeId: equipment.operatorEmployeeId,
  operatorOutsideFullName: equipment.operatorOutsideFullName,
  operatorOutsideCompanyName: equipment.operatorOutsideCompanyName,
  operatorOutsideNationalId: equipment.operatorOutsideNationalId,
  operatorOutsideSgkNo: equipment.operatorOutsideSgkNo,
  operatorCertificateNo: equipment.operatorCertificateNo,
  createdAt: equipment.createdAt,
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { projectId, companyId } = req.query;
    if (!projectId && !companyId) throw ApiError.badRequest('projectId veya companyId zorunludur.');
    const conditions = [];
    if (projectId) conditions.push(eq(equipment.projectId, projectId));
    if (companyId) conditions.push(eq(equipment.companyId, companyId));

    const rows = await db
      .select(EQUIPMENT_SELECT)
      .from(equipment)
      .leftJoin(companies, eq(equipment.companyId, companies.id))
      .leftJoin(employees, eq(equipment.assignedEmployeeId, employees.id))
      .where(and(...conditions))
      .orderBy(desc(equipment.createdAt));
    res.json({ equipment: rows });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = baseSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz ekipman bilgisi.', parsed.error.flatten());
    const data = parsed.data;

    const [company] = await db.select().from(companies).where(eq(companies.id, data.companyId)).limit(1);
    if (!company || company.projectId !== data.projectId) throw ApiError.badRequest('Firma bu projeye ait değil.');

    const [created] = await db
      .insert(equipment)
      .values({
        projectId: data.projectId,
        companyId: data.companyId,
        name: data.name,
        serialNumber: data.serialNumber || null,
        licenseNumber: data.licenseNumber || null,
        periodicInspectionDate: toDateOrNull(data.periodicInspectionDate),
        periodicInspectionValidUntil: toDateOrNull(data.periodicInspectionValidUntil),
        hasDamage: data.hasDamage ?? false,
        damageDescription: data.damageDescription || null,
        fitForUse: data.fitForUse ?? true,
        assignedTo: data.assignedTo ?? 'FIRMA',
        assignedEmployeeId: data.assignedTo === 'KISI' ? data.assignedEmployeeId || null : null,
        operatorSource: data.operatorSource ?? 'YOK',
        operatorEmployeeId: data.operatorSource === 'CALISAN' ? data.operatorEmployeeId || null : null,
        operatorOutsideFullName: data.operatorSource === 'DISARIDAN' ? data.operatorOutsideFullName || null : null,
        operatorOutsideCompanyName: data.operatorSource === 'DISARIDAN' ? data.operatorOutsideCompanyName || null : null,
        operatorOutsideNationalId: data.operatorSource === 'DISARIDAN' ? data.operatorOutsideNationalId || null : null,
        operatorOutsideSgkNo: data.operatorSource === 'DISARIDAN' ? data.operatorOutsideSgkNo || null : null,
        operatorCertificateNo: data.operatorCertificateNo || null,
        createdById: req.user.sub,
      })
      .returning();

    await logAudit({ userId: req.user.sub, action: 'EQUIPMENT_CREATE', entityType: 'equipment', entityId: created.id, details: { name: data.name, companyId: data.companyId }, ipAddress: req.ip });
    res.status(201).json({ equipment: created });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz ekipman bilgisi.', parsed.error.flatten());
    const data = parsed.data;

    const patch = { ...data };
    if ('periodicInspectionDate' in patch) patch.periodicInspectionDate = toDateOrNull(patch.periodicInspectionDate);
    if ('periodicInspectionValidUntil' in patch) patch.periodicInspectionValidUntil = toDateOrNull(patch.periodicInspectionValidUntil);

    const [updated] = await db.update(equipment).set(patch).where(eq(equipment.id, req.params.id)).returning();
    if (!updated) throw ApiError.notFound('Kayıt bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'EQUIPMENT_UPDATE', entityType: 'equipment', entityId: updated.id, details: data, ipAddress: req.ip });
    res.json({ equipment: updated });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [deleted] = await db.delete(equipment).where(eq(equipment.id, req.params.id)).returning();
    if (!deleted) throw ApiError.notFound('Kayıt bulunamadı.');
    await logAudit({ userId: req.user.sub, action: 'EQUIPMENT_DELETE', entityType: 'equipment', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
