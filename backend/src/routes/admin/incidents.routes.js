const express = require('express');
const { z } = require('zod');
const { eq, and, desc, sql, inArray } = require('drizzle-orm');
const { db } = require('../../db/client');
const { incidents, companies, employees, companyRoleAssignments } = require('../../db/schema');
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
  // İlk yardım müdahalesini yapan kişi ya firma rolü kaydından (DSP/İlkyardımcı - firstAidGivenById)
  // ya da "Diğer" (serbest firstAidGivenBy ad + outside* alanları) seçilir. firstAidGivenBy her
  // durumda gösterim adı olarak dolu tutulur (frontend, seçime göre bunu kendisi dolduruyor).
  firstAidGivenBy: z.string().optional().nullable(),
  firstAidGivenById: z.string().optional().nullable(),
  firstAidGivenByOutsideNationalId: z.string().optional().nullable(),
  firstAidGivenByOutsidePhone: z.string().optional().nullable(),
  firstAidGivenByOutsideCompanyName: z.string().optional().nullable(),
  victimProfession: z.string().optional().nullable(),
  doctorReportPhotoKey: z.string().optional().nullable(),
  reportDaysOff: z.number().int().min(0).optional().nullable(),
  returnToWorkDate: z.string().optional().nullable(),
  returnToWorkTrainingGiven: z.boolean().optional().default(false),
  returnToWorkTrainingTopic: z.string().optional().nullable(),
  returnToWorkTrainingDuration: z.string().optional().nullable(),
  actionsTaken: z.string().optional().nullable(),
});

const updateSchema = baseSchema.partial().omit({ companyId: true });

/**
 * Firma adının ilk 3 harfinden (Türkçe karakterler dahil, boşluk/özel karakter atlanarak) ve
 * olay türünden (KAZA->KZ, RAMAK_KALA->RK) + yıldan + o firma/tür/yıl için sıradaki numaradan
 * bir kayıt kodu üretir (ör. "ABC-KZ-2026-001"). Aynı anda iki kayıt oluşturulursa (nadir) ve
 * kod çakışırsa, çağıran taraf (POST /) birkaç kez tekrar dener.
 */
async function generateIncidentCode(companyId, type, eventDateTime) {
  const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1);
  const prefix = (company?.name || 'XXX').replace(/[^A-Za-zÇĞİÖŞÜçğıöşü0-9]/g, '').slice(0, 3).toUpperCase() || 'XXX';
  const typeCode = type === 'KAZA' ? 'KZ' : 'RK';
  const year = new Date(eventDateTime).getFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const [{ value: existingCount }] = await db
    .select({ value: sql`count(*)`.mapWith(Number) })
    .from(incidents)
    .where(
      and(
        eq(incidents.companyId, companyId),
        eq(incidents.type, type),
        sql`${incidents.eventDateTime} >= ${yearStart} and ${incidents.eventDateTime} < ${yearEnd}`
      )
    );
  const seq = existingCount + 1;
  return `${prefix}-${typeCode}-${year}-${String(seq).padStart(3, '0')}`;
}

/**
 * Bir çalışanın kaç numaralı kazası olduğunu (yalnızca type='KAZA', tarihe göre kronolojik
 * sırayla) hesaplar. Çalışan kartında/kaza kayıtlarında "2. Kazası" gibi gösterilebilsin diye.
 */
async function computeEmployeeIncidentSequence(employeeIds) {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: incidents.id, employeeId: incidents.employeeId, eventDateTime: incidents.eventDateTime })
    .from(incidents)
    .where(and(eq(incidents.type, 'KAZA'), inArray(incidents.employeeId, ids)))
    .orderBy(incidents.eventDateTime);
  const seqByEmployee = new Map();
  const seqById = new Map();
  for (const r of rows) {
    const n = (seqByEmployee.get(r.employeeId) || 0) + 1;
    seqByEmployee.set(r.employeeId, n);
    seqById.set(r.id, n);
  }
  return seqById;
}

/**
 * firstAidGivenById (varsa) için bu kaydın gerçekten o firmaya ait ve DSP veya İlkyardımcı
 * rolünde olduğunu doğrular - aksi halde bir kullanıcı başka bir firmanın kişisini ya da
 * alakasız bir rolü (ör. Şantiye Şefi) ilk yardım yapan olarak bağlayabilir.
 */
async function assertFirstAidAssignment(assignmentId, companyId) {
  if (!assignmentId) return;
  const [row] = await db.select().from(companyRoleAssignments).where(eq(companyRoleAssignments.id, assignmentId)).limit(1);
  if (!row || row.companyId !== companyId) throw ApiError.badRequest('Seçilen ilk yardımcı bu firmaya ait değil.');
  if (!['DIGER_SAGLIK_PERSONELI', 'ILKYARDIM'].includes(row.roleType)) {
    throw ApiError.badRequest('Seçilen kayıt DSP veya İlkyardımcı rolünde değil.');
  }
}

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
        code: incidents.code,
        type: incidents.type,
        eventDateTime: incidents.eventDateTime,
        employeeId: incidents.employeeId,
        employeeFullName: employees.fullName,
        employeeStartDate: employees.startDate,
        eventDescription: incidents.eventDescription,
        location: incidents.location,
        cause: incidents.cause,
        witnessEmployeeId: incidents.witnessEmployeeId,
        witnessStatement: incidents.witnessStatement,
        referredToHospital: incidents.referredToHospital,
        hospitalName: incidents.hospitalName,
        firstAidGiven: incidents.firstAidGiven,
        firstAidGivenBy: incidents.firstAidGivenBy,
        firstAidGivenById: incidents.firstAidGivenById,
        firstAidGivenByOutsideNationalId: incidents.firstAidGivenByOutsideNationalId,
        firstAidGivenByOutsidePhone: incidents.firstAidGivenByOutsidePhone,
        firstAidGivenByOutsideCompanyName: incidents.firstAidGivenByOutsideCompanyName,
        victimProfession: incidents.victimProfession,
        doctorReportPhotoKey: incidents.doctorReportPhotoKey,
        reportDaysOff: incidents.reportDaysOff,
        returnToWorkDate: incidents.returnToWorkDate,
        returnToWorkTrainingGiven: incidents.returnToWorkTrainingGiven,
        returnToWorkTrainingTopic: incidents.returnToWorkTrainingTopic,
        returnToWorkTrainingDuration: incidents.returnToWorkTrainingDuration,
        actionsTaken: incidents.actionsTaken,
        createdAt: incidents.createdAt,
      })
      .from(incidents)
      .leftJoin(employees, eq(incidents.employeeId, employees.id))
      .where(and(...conditions))
      .orderBy(desc(incidents.eventDateTime));

    const seqById = await computeEmployeeIncidentSequence(rows.map((r) => r.employeeId));

    const withUrls = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        employeeIncidentSeq: r.type === 'KAZA' ? seqById.get(r.id) || null : null,
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
    await assertFirstAidAssignment(data.firstAidGivenById || null, data.companyId);

    const values = {
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
      firstAidGivenById: data.firstAidGivenById || null,
      firstAidGivenByOutsideNationalId: data.firstAidGivenByOutsideNationalId || null,
      firstAidGivenByOutsidePhone: data.firstAidGivenByOutsidePhone || null,
      firstAidGivenByOutsideCompanyName: data.firstAidGivenByOutsideCompanyName || null,
      victimProfession: data.victimProfession || null,
      doctorReportPhotoKey: data.doctorReportPhotoKey || null,
      reportDaysOff: data.reportDaysOff ?? null,
      returnToWorkDate: toDateOrNull(data.returnToWorkDate),
      returnToWorkTrainingGiven: data.returnToWorkTrainingGiven ?? false,
      returnToWorkTrainingTopic: data.returnToWorkTrainingTopic || null,
      returnToWorkTrainingDuration: data.returnToWorkTrainingDuration || null,
      actionsTaken: data.actionsTaken || null,
      createdById: req.user.sub,
    };

    // Kod üretimi + ekleme: çok nadir bir yarış durumunda (aynı firma/tür/yıl için aynı anda iki
    // kayıt) unique constraint çakışması olursa kodu yeniden hesaplayıp birkaç kez dener.
    let created;
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = await generateIncidentCode(data.companyId, data.type, data.eventDateTime);
      try {
        [created] = await db.insert(incidents).values({ ...values, code }).returning();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (!/unique|duplicate/i.test(err.message || '')) throw err;
      }
    }
    if (lastErr) throw lastErr;

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

    const [existing] = await db.select().from(incidents).where(eq(incidents.id, req.params.id)).limit(1);
    if (!existing) throw ApiError.notFound('Kayıt bulunamadı.');
    if (data.firstAidGivenById !== undefined) {
      await assertFirstAidAssignment(data.firstAidGivenById || null, existing.companyId);
    }

    const patch = { ...data };
    if ('eventDateTime' in patch) patch.eventDateTime = new Date(patch.eventDateTime);
    if ('returnToWorkDate' in patch) {
      patch.returnToWorkDate = toDateOrNull(patch.returnToWorkDate);
      patch.returnToWorkReminderSentAt = null; // tarih değiştiyse bildirim yeniden tetiklenebilsin
    }

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
