const express = require('express');
const { z } = require('zod');
const { eq, and, desc } = require('drizzle-orm');
const { db } = require('../../db/client');
const { incidents, companies, employees } = require('../../db/schema');
const { requirePermission } = require('../../middleware/permission');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { logAudit } = require('../../utils/audit');
const { createViewUrl } = require('../../services/storage.service');

const router = express.Router();

// Kayıt görüntüleme/girme "firma_yonetme" (tam firma yönetimi) yetkisi OLMADAN da, daha dar
// kapsamlı "kaza_bildirimi" yetkisiyle mümkündür (uygunsuzluk açma yetkisiyle aynı mantık: bu
// kullanıcılar yalnızca kendi aktif proje bağlamındaki firmalar için kayıt girebilir/görebilir,
// firma bazlı bir kısıtlama uygulanmaz). Düzenleme/silme ise yalnızca firma_yonetme ile mümkündür.
const VIEW_OR_CREATE_PERMISSIONS = ['firma_yonetme', 'kaza_bildirimi'];

const INCIDENT_TYPES = ['KAZA', 'RAMAK_KALA'];

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function hasPermission(req, key) {
  return req.user.isSystemAdmin || (req.user.permissions || []).includes(key);
}

/**
 * "kaza_bildirimi" yetkisiyle (firma_yonetme olmadan) erişen kullanıcılar yalnızca kendi
 * aktif proje bağlamlarındaki firmalar/çalışanlar için kayıt girebilir/görebilir. firma_yonetme
 * sahipleri veya sistem admini bu kısıtlamaya tabi değildir.
 */
async function assertProjectScopedAccess(req, { companyId, employeeId }) {
  if (req.user.isSystemAdmin || hasPermission(req, 'firma_yonetme')) return;

  let projectId = null;
  if (companyId) {
    const [company] = await db.select({ projectId: companies.projectId }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');
    projectId = company.projectId;
  } else if (employeeId) {
    const [employee] = await db.select({ projectId: employees.projectId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
    if (!employee) throw ApiError.notFound('Çalışan bulunamadı.');
    projectId = employee.projectId;
  }

  if (projectId && projectId !== req.user.projectId) {
    throw ApiError.forbidden('Bu kayıtlar için yetkiniz yok.');
  }
}

const baseSchema = z.object({
  companyId: z.string().min(1),
  type: z.enum(INCIDENT_TYPES),
  eventDateTime: z.string().min(1, 'Olay tarihi/saati zorunludur.'),
  employeeId: z.string().optional().nullable(),
  eventDescription: z.string().min(3, 'Olay şekli açıklaması zorunludur.'),
  location: z.string().optional().nullable(),
  cause: z.string().optional().nullable(),
  witnessEmployeeId: z.string().optional().nullable(),
  witnessStatement: z.string().optional().nullable(),
  referredToHospital: z.boolean().optional().default(false),
  hospitalName: z.string().optional().nullable(),
  firstAidGiven: z.boolean().optional().default(false),
  firstAidGivenBy: z.string().optional().nullable(),
  victimProfession: z.string().optional().nullable(),
  doctorReportPhotoKey: z.string().optional().nullable(),
  reportDaysOff: z.number().int().min(0).optional().nullable(),
  returnToWorkDate: z.string().optional().nullable(),
  actionsTaken: z.string().optional().nullable(),
});

const updateSchema = baseSchema.partial().omit({ companyId: true });

// ---------------------------------------------------------------------------
// Kaza / ramak kala bildirme formu için referans veriler (firma listesi) - firma_yonetme
// olmadan yalnızca kaza_bildirimi yetkisiyle erişen kullanıcılar için de çalışır; nonconformities
// route'undaki /reference-data ile aynı mantık, yalnızca kullanıcının aktif proje bağlamına göre.
// ---------------------------------------------------------------------------
router.get(
  '/reference-data',
  requirePermission(VIEW_OR_CREATE_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const projectId = req.user.isSystemAdmin ? req.query.projectId : req.user.projectId;
    if (!projectId) throw ApiError.badRequest('projectId zorunludur.');
    const companyRows = await db
      .select()
      .from(companies)
      .where(and(eq(companies.projectId, projectId), eq(companies.isActive, true)))
      .orderBy(companies.name);
    res.json({ companies: companyRows });
  })
);

router.get(
  '/',
  requirePermission(VIEW_OR_CREATE_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const { companyId, type, employeeId } = req.query;
    if (!companyId && !employeeId) throw ApiError.badRequest('companyId veya employeeId zorunludur.');
    await assertProjectScopedAccess(req, { companyId, employeeId });

    const conditions = [];
    if (companyId) conditions.push(eq(incidents.companyId, companyId));
    if (type) conditions.push(eq(incidents.type, type));
    if (employeeId) conditions.push(eq(incidents.employeeId, employeeId));

    const rows = await db
      .select({
        id: incidents.id,
        companyId: incidents.companyId,
        type: incidents.type,
        eventDateTime: incidents.eventDateTime,
        employeeId: incidents.employeeId,
        employeeFullName: employees.fullName,
        eventDescription: incidents.eventDescription,
        location: incidents.location,
        cause: incidents.cause,
        witnessEmployeeId: incidents.witnessEmployeeId,
        witnessStatement: incidents.witnessStatement,
        referredToHospital: incidents.referredToHospital,
        hospitalName: incidents.hospitalName,
        firstAidGiven: incidents.firstAidGiven,
        firstAidGivenBy: incidents.firstAidGivenBy,
        victimProfession: incidents.victimProfession,
        doctorReportPhotoKey: incidents.doctorReportPhotoKey,
        reportDaysOff: incidents.reportDaysOff,
        returnToWorkDate: incidents.returnToWorkDate,
        actionsTaken: incidents.actionsTaken,
        createdAt: incidents.createdAt,
      })
      .from(incidents)
      .leftJoin(employees, eq(incidents.employeeId, employees.id))
      .where(and(...conditions))
      .orderBy(desc(incidents.eventDateTime));

    const withUrls = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        doctorReportViewUrl: r.doctorReportPhotoKey ? await createViewUrl(r.doctorReportPhotoKey).catch(() => null) : null,
      }))
    );
    res.json({ incidents: withUrls });
  })
);

router.post(
  '/',
  requirePermission(VIEW_OR_CREATE_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const parsed = baseSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz kayıt bilgisi.', parsed.error.flatten());
    const data = parsed.data;

    const [company] = await db.select().from(companies).where(eq(companies.id, data.companyId)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');
    await assertProjectScopedAccess(req, { companyId: data.companyId });

    const [created] = await db
      .insert(incidents)
      .values({
        companyId: data.companyId,
        type: data.type,
        eventDateTime: new Date(data.eventDateTime),
        employeeId: data.employeeId || null,
        eventDescription: data.eventDescription,
        location: data.location || null,
        cause: data.cause || null,
        witnessEmployeeId: data.witnessEmployeeId || null,
        witnessStatement: data.witnessStatement || null,
        referredToHospital: data.referredToHospital ?? false,
        hospitalName: data.hospitalName || null,
        firstAidGiven: data.firstAidGiven ?? false,
        firstAidGivenBy: data.firstAidGivenBy || null,
        victimProfession: data.victimProfession || null,
        doctorReportPhotoKey: data.doctorReportPhotoKey || null,
        reportDaysOff: data.reportDaysOff ?? null,
        returnToWorkDate: toDateOrNull(data.returnToWorkDate),
        actionsTaken: data.actionsTaken || null,
        createdById: req.user.sub,
      })
      .returning();

    await logAudit({ userId: req.user.sub, action: 'INCIDENT_CREATE', entityType: 'incident', entityId: created.id, details: { type: data.type, companyId: data.companyId }, ipAddress: req.ip });
    res.status(201).json({ incident: created });
  })
);

router.patch(
  '/:id',
  requirePermission('firma_yonetme'),
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz kayıt bilgisi.', parsed.error.flatten());
    const data = parsed.data;

    const patch = { ...data };
    if ('eventDateTime' in patch) patch.eventDateTime = new Date(patch.eventDateTime);
    if ('returnToWorkDate' in patch) patch.returnToWorkDate = toDateOrNull(patch.returnToWorkDate);

    const [updated] = await db.update(incidents).set(patch).where(eq(incidents.id, req.params.id)).returning();
    if (!updated) throw ApiError.notFound('Kayıt bulunamadı.');

    await logAudit({ userId: req.user.sub, action: 'INCIDENT_UPDATE', entityType: 'incident', entityId: updated.id, details: data, ipAddress: req.ip });
    res.json({ incident: updated });
  })
);

router.delete(
  '/:id',
  requirePermission('firma_yonetme'),
  asyncHandler(async (req, res) => {
    const [deleted] = await db.delete(incidents).where(eq(incidents.id, req.params.id)).returning();
    if (!deleted) throw ApiError.notFound('Kayıt bulunamadı.');
    await logAudit({ userId: req.user.sub, action: 'INCIDENT_DELETE', entityType: 'incident', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
