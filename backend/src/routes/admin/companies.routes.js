const express = require('express');
const { z } = require('zod');
const { db } = require('../../db/client');
const {
  companies,
  companyUsers,
  users,
  companyBlocks,
  projectBlocks,
  companyRoleAssignments,
  employees,
  incidents,
  companyDocuments,
  boardMeetings,
  equipment,
  penalties,
} = require('../../db/schema');
const { eq, and, desc, sql, inArray } = require('drizzle-orm');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requirePermission } = require('../../middleware/permission');
const { logAudit } = require('../../utils/audit');
const { createViewUrl } = require('../../services/storage.service');
const { computeBoardStatus } = require('../../services/board-meeting.service');
const { runOrQueueForApproval } = require('../../utils/approval');

const router = express.Router();

// Görüntüleme (liste + detay) 'firma_yonetme' VEYA 'firma_goruntuleme' ile mümkündür; firma
// kaydı oluşturma/düzenleme/silme ve alt kaynakların (roller vb.) değiştirilmesi hâlâ yalnızca
// 'firma_yonetme' gerektirir - bu yüzden router genelinde tek bir requirePermission yerine,
// yazma rotalarının her birine ayrı ayrı 'firma_yonetme' eklenir.
const VIEW_PERMISSIONS = ['firma_yonetme', 'firma_goruntuleme'];

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
  requiresBoard: z.boolean().optional(),
  dangerClass: z.enum(DANGER_CLASSES).optional().nullable(),
  // Firmanın sorumlu olduğu bölge/blok id'leri. Boş dizi/undefined -> "Tüm Bölgeler" (proje
  // genelinden sorumlu) anlamına gelir. bkz. company_blocks tablosu.
  blockIds: z.array(z.string()).optional(),
});

const companyUpdateSchema = companySchema.partial().omit({ projectId: true });

/** Verilen firma id listesi için: bölgeler, çalışan/ekipman/rol sayıları, kaza/ramak kala sayılarını toplu olarak getirir. */
async function loadCompanySummaries(companyIds) {
  if (companyIds.length === 0) {
    return new Map();
  }

  const [blockRows, employeeCounts, equipmentCounts, incidentCounts, roleCounts] = await Promise.all([
    db
      .select({ companyId: companyBlocks.companyId, blockId: companyBlocks.blockId, blockName: projectBlocks.name })
      .from(companyBlocks)
      .innerJoin(projectBlocks, eq(companyBlocks.blockId, projectBlocks.id))
      .where(inArray(companyBlocks.companyId, companyIds)),
    db
      .select({ companyId: employees.companyId, count: sql`count(*)`.mapWith(Number) })
      .from(employees)
      .where(and(inArray(employees.companyId, companyIds), eq(employees.isActive, true)))
      .groupBy(employees.companyId),
    db
      .select({ companyId: equipment.companyId, count: sql`count(*)`.mapWith(Number) })
      .from(equipment)
      .where(inArray(equipment.companyId, companyIds))
      .groupBy(equipment.companyId),
    db
      .select({
        companyId: incidents.companyId,
        kazaCount: sql`count(*) filter (where ${incidents.type} = 'KAZA')`.mapWith(Number),
        ramakKalaCount: sql`count(*) filter (where ${incidents.type} = 'RAMAK_KALA')`.mapWith(Number),
      })
      .from(incidents)
      .where(inArray(incidents.companyId, companyIds))
      .groupBy(incidents.companyId),
    db
      .select({ companyId: companyRoleAssignments.companyId, count: sql`count(*)`.mapWith(Number) })
      .from(companyRoleAssignments)
      .where(inArray(companyRoleAssignments.companyId, companyIds))
      .groupBy(companyRoleAssignments.companyId),
  ]);

  const summaries = new Map();
  for (const id of companyIds) {
    summaries.set(id, { blocks: [], employeeCount: 0, equipmentCount: 0, kazaCount: 0, ramakKalaCount: 0, roleAssignmentCount: 0 });
  }
  for (const row of blockRows) {
    summaries.get(row.companyId)?.blocks.push({ id: row.blockId, name: row.blockName });
  }
  for (const row of employeeCounts) {
    if (summaries.has(row.companyId)) summaries.get(row.companyId).employeeCount = row.count;
  }
  for (const row of equipmentCounts) {
    if (summaries.has(row.companyId)) summaries.get(row.companyId).equipmentCount = row.count;
  }
  for (const row of incidentCounts) {
    const s = summaries.get(row.companyId);
    if (s) {
      s.kazaCount = row.kazaCount;
      s.ramakKalaCount = row.ramakKalaCount;
    }
  }
  for (const row of roleCounts) {
    if (summaries.has(row.companyId)) summaries.get(row.companyId).roleAssignmentCount = row.count;
  }
  return summaries;
}

/** company_blocks tablosunu verilen firma için blockIds listesiyle eşleşecek şekilde senkronize eder. */
async function syncCompanyBlocks(tx, companyId, blockIds) {
  await tx.delete(companyBlocks).where(eq(companyBlocks.companyId, companyId));
  if (blockIds && blockIds.length > 0) {
    await tx.insert(companyBlocks).values([...new Set(blockIds)].map((blockId) => ({ companyId, blockId })));
  }
}

router.get(
  '/',
  requirePermission(VIEW_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const rows = projectId
      ? await db.select().from(companies).where(eq(companies.projectId, projectId))
      : await db.select().from(companies);

    const summaries = await loadCompanySummaries(rows.map((c) => c.id));
    const companiesWithSummary = rows.map((c) => ({ ...c, summary: summaries.get(c.id) }));

    res.json({ companies: companiesWithSummary });
  })
);

router.post(
  '/',
  requirePermission('firma_yonetme'),
  asyncHandler(async (req, res) => {
    const parsed = companySchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz firma bilgisi.', parsed.error.flatten());

    const { blockIds, ...companyData } = parsed.data;

    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(companies).values(companyData).returning();
      await syncCompanyBlocks(tx, row.id, blockIds);
      return row;
    });

    await logAudit({ userId: req.user.sub, action: 'COMPANY_CREATE', entityType: 'company', entityId: created.id, details: parsed.data, ipAddress: req.ip });
    res.status(201).json({ company: created });
  })
);

router.get(
  '/:id',
  requirePermission(VIEW_PERMISSIONS),
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

    // Bu firmanın sorumlu olduğu bölgeler (boşsa "Tüm Bölgeler" anlamına gelir).
    const blockRows = await db
      .select({ id: projectBlocks.id, name: projectBlocks.name })
      .from(companyBlocks)
      .innerJoin(projectBlocks, eq(companyBlocks.blockId, projectBlocks.id))
      .where(eq(companyBlocks.companyId, company.id));

    res.json({
      company,
      blocks: blockRows,
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

// Firma düzenleme kritik/geri dönülmez sayılan işlemlerdendir (bkz. utils/approval.js): admin
// bu isteği anında uygular, admin olmayan biri isterse istek admin onayına kuyruğa alınır ve
// yalnızca admin onaylarsa gerçek güncelleme services/criticalActions.service.js -> COMPANY_UPDATE
// üzerinden uygulanır.
router.patch(
  '/:id',
  requirePermission('firma_yonetme'),
  asyncHandler(async (req, res) => {
    const parsed = companyUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz firma bilgisi.', parsed.error.flatten());

    const [company] = await db.select().from(companies).where(eq(companies.id, req.params.id)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');

    const { blockIds, ...companyData } = parsed.data;

    await runOrQueueForApproval(req, res, {
      actionType: 'COMPANY_UPDATE',
      entityType: 'company',
      entityId: company.id,
      payload: { companyId: company.id, companyData, blockIds },
      summary: `"${company.name}" firmasının bilgileri güncellenecek.`,
      projectId: company.projectId,
    });
  })
);

// Firmalar kalıcı silinmez; pasif duruma alınır (soft delete). Yine de kritik/geri dönülmez
// kabul edilir (firmayı tüm listelerden/atamalardan gizler) ve admin onayına tabidir.
router.delete(
  '/:id',
  requirePermission('firma_yonetme'),
  asyncHandler(async (req, res) => {
    const [company] = await db.select().from(companies).where(eq(companies.id, req.params.id)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');

    await runOrQueueForApproval(req, res, {
      actionType: 'COMPANY_DELETE',
      entityType: 'company',
      entityId: company.id,
      payload: { companyId: company.id },
      summary: `"${company.name}" firması silinecek (pasife alınacak).`,
      projectId: company.projectId,
    });
  })
);

const addRepSchema = z.object({
  userId: z.string().min(1),
  title: z.string().optional().nullable(),
});

router.post(
  '/:id/users',
  requirePermission('firma_yonetme'),
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
  requirePermission('firma_yonetme'),
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
