const express = require('express');
const { z } = require('zod');
const { db } = require('../../db/client');
const {
  companies,
  companyUsers,
  users,
  companyRoleAssignments,
  employees,
  incidents,
  companyDocuments,
  boardMeetings,
  equipment,
  penalties,
} = require('../../db/schema');
const { eq, and, desc, sql } = require('drizzle-orm');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requirePermission } = require('../../middleware/permission');
const { logAudit } = require('../../utils/audit');
const { createViewUrl } = require('../../services/storage.service');
const { computeBoardStatus } = require('../../services/board-meeting.service');

const router = express.Router();
router.use(requirePermission('firma_yonetme'));

const COMPANY_TYPES = ['ANA_FIRMA', 'ALT_ISVEREN', 'TASERON', 'UCUNCU_SAHIS_HIZMET_VEREN', 'TEDARIKCI', 'DIGER'];
const DANGER_CLASSES = ['COK_TEHLIKELI', 'TEHLIKELI', 'AZ_TEHLIKELI'];

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
  requiresBoard: z.boolean().optional(),
  dangerClass: z.enum(DANGER_CLASSES).optional().nullable(),
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

    // Firma rolleri + acil durum ekipleri (aynı tablo, roleType ile ayrışır).
    const roleRows = await db
      .select({
        id: companyRoleAssignments.id,
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
      .where(eq(companyRoleAssignments.companyId, company.id))
      .orderBy(desc(companyRoleAssignments.createdAt));

    // Kaza/ramak kala: son 10 kayıt + tip bazlı toplam sayı.
    const incidentRows = await db
      .select({
        id: incidents.id,
        type: incidents.type,
        eventDateTime: incidents.eventDateTime,
        employeeFullName: employees.fullName,
        eventDescription: incidents.eventDescription,
        reportDaysOff: incidents.reportDaysOff,
      })
      .from(incidents)
      .leftJoin(employees, eq(incidents.employeeId, employees.id))
      .where(eq(incidents.companyId, company.id))
      .orderBy(desc(incidents.eventDateTime))
      .limit(10);
    const [incidentCounts] = await db
      .select({
        kazaCount: sql`count(*) filter (where ${incidents.type} = 'KAZA')`.mapWith(Number),
        ramakKalaCount: sql`count(*) filter (where ${incidents.type} = 'RAMAK_KALA')`.mapWith(Number),
      })
      .from(incidents)
      .where(eq(incidents.companyId, company.id));

    // Risk analizi + acil durum eylem planı belgeleri.
    const documentRows = await db
      .select()
      .from(companyDocuments)
      .where(eq(companyDocuments.companyId, company.id))
      .orderBy(desc(companyDocuments.createdAt));
    const documentsWithUrl = await Promise.all(
      documentRows.map(async (d) => ({
        ...d,
        fileViewUrl: d.fileObjectKey ? await createViewUrl(d.fileObjectKey).catch(() => null) : null,
      }))
    );

    // İSG kurulu toplantıları + dönem bazlı durum hesaplaması.
    const meetingRows = await db
      .select()
      .from(boardMeetings)
      .where(eq(boardMeetings.companyId, company.id))
      .orderBy(desc(boardMeetings.meetingDate));
    const meetingsWithUrl = await Promise.all(
      meetingRows.map(async (m) => ({
        ...m,
        attendanceFormViewUrl: m.attendanceFormFileKey ? await createViewUrl(m.attendanceFormFileKey).catch(() => null) : null,
      }))
    );
    const boardStatus = computeBoardStatus(company.dangerClass, meetingRows);

    // Ekipman sayısı (liste ayrı uç noktadan, ?companyId= ile alınır).
    const [equipmentCountRow] = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(equipment)
      .where(eq(equipment.companyId, company.id));

    // MYK mesleki yeterlilik belgesi oranı.
    const [mykStatsRow] = await db
      .select({
        total: sql`count(*)`.mapWith(Number),
        withCertificate: sql`count(*) filter (where ${employees.mykCertificateNo} is not null and ${employees.mykCertificateNo} <> '')`.mapWith(Number),
      })
      .from(employees)
      .where(and(eq(employees.companyId, company.id), eq(employees.isActive, true)));

    // Ceza istatistikleri (bu firmanın çalışanlarına bağlı cezalar).
    const penaltyRows = await db
      .select({
        id: penalties.id,
        status: penalties.status,
        sanctionType: penalties.sanctionType,
        reason: penalties.reason,
        requestedAt: penalties.requestedAt,
        employeeFullName: employees.fullName,
      })
      .from(penalties)
      .innerJoin(employees, eq(penalties.employeeId, employees.id))
      .where(eq(employees.companyId, company.id))
      .orderBy(desc(penalties.requestedAt))
      .limit(10);
    const [penaltyCounts] = await db
      .select({
        pending: sql`count(*) filter (where ${penalties.status} = 'BEKLEMEDE')`.mapWith(Number),
        approved: sql`count(*) filter (where ${penalties.status} = 'ONAYLANDI')`.mapWith(Number),
        rejected: sql`count(*) filter (where ${penalties.status} = 'REDDEDILDI')`.mapWith(Number),
      })
      .from(penalties)
      .innerJoin(employees, eq(penalties.employeeId, employees.id))
      .where(eq(employees.companyId, company.id));

    res.json({
      company,
      representatives: reps,
      roleAssignments: roleRows,
      incidents: { recent: incidentRows, counts: incidentCounts },
      documents: documentsWithUrl,
      boardMeetings: meetingsWithUrl,
      boardStatus,
      equipmentCount: equipmentCountRow.count,
      mykStats: mykStatsRow,
      penalties: { recent: penaltyRows, counts: penaltyCounts },
    });
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
