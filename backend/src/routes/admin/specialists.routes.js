const express = require('express');
const { eq, and, inArray, or, isNull, gte, sql } = require('drizzle-orm');
const { db } = require('../../db/client');
const {
  companyRoleAssignments,
  companies,
  employees,
  boardMeetings,
  companyDocuments,
  incidents,
  nonconformities,
} = require('../../db/schema');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requirePermission } = require('../../middleware/permission');

const router = express.Router();

// Bu sayfa salt-görüntüleme bir özet/rapor sayfasıdır - firma verilerini görebilen veya
// raporlama yetkisi olan herkes erişebilir; herhangi bir yazma işlemi yoktur.
const VIEW_PERMISSIONS = ['firma_yonetme', 'firma_goruntuleme', 'gecici_gorevlendirme_yonetimi', 'rapor_goruntuleme'];

const SUPPORTED_TYPES = ['ISG_UZMANI', 'ISYERI_HEKIMI'];

// Mevzuata göre (İSGUY md.12 Ek-2 / İşyeri Hekimi Yönetmeliği md.12 Ek-5) tehlike sınıfına göre
// çalışan başına ayda asgari görevlendirme süresi (dakika). bkz. Phase 4 madde 7 - "mevzuata
// göre tehlike sınıflarına göre çalışan sayıları sürelerini otomatik hesaplayacak".
const MINUTES_PER_EMPLOYEE_PER_MONTH = {
  ISG_UZMANI: { AZ_TEHLIKELI: 10, TEHLIKELI: 20, COK_TEHLIKELI: 40 },
  ISYERI_HEKIMI: { AZ_TEHLIKELI: 5, TEHLIKELI: 10, COK_TEHLIKELI: 15 },
};

// İSG Uzmanı sertifika sınıfının hangi tehlike sınıflarında görev almasına izin verildiği
// (A sınıfı tüm sınıflar, B sınıfı az+tehlikeli, C sınıfı yalnızca az tehlikeli). Yalnızca
// ISG_UZMANI tipi için anlamlıdır; İşyeri Hekimi için sınıf bazlı bir kısıtlama yoktur.
const ISG_UZMANI_CLASS_ALLOWED_DANGER_CLASSES = {
  'A Sınıfı': ['AZ_TEHLIKELI', 'TEHLIKELI', 'COK_TEHLIKELI'],
  'B Sınıfı': ['AZ_TEHLIKELI', 'TEHLIKELI'],
  'C Sınıfı': ['AZ_TEHLIKELI'],
};

/** Bir atamanın "hâlâ aktif" sayılıp sayılmadığını belirler: çıkış tarihi yoksa veya bugünden ilerideyse aktiftir. */
function isAssignmentActive(certificateEndDate) {
  if (!certificateEndDate) return true;
  return new Date(certificateEndDate).getTime() >= Date.now();
}

/** Bir kişiyi (CALISAN ise employeeId, DISARIDAN ise TC/ad üzerinden) tekilleştirmek için anahtar üretir. */
function personKey(row) {
  if (row.source === 'CALISAN' && row.employeeId) return `emp:${row.employeeId}`;
  const idPart = (row.outsideNationalId || '').trim();
  if (idPart) return `out-id:${idPart}`;
  return `out-name:${(row.outsideFullName || '').trim().toLocaleLowerCase('tr-TR')}`;
}

router.get(
  '/',
  requirePermission(VIEW_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const type = req.query.type;
    if (!SUPPORTED_TYPES.includes(type)) {
      throw ApiError.badRequest('Geçersiz tip. type=ISG_UZMANI veya type=ISYERI_HEKIMI olmalıdır.');
    }
    const projectId = req.query.projectId || null;

    const now = new Date();
    const assignmentRows = await db
      .select({
        id: companyRoleAssignments.id,
        companyId: companyRoleAssignments.companyId,
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
        createdAt: companyRoleAssignments.createdAt,
        companyName: companies.name,
        companyDangerClass: companies.dangerClass,
        companyProjectId: companies.projectId,
        companyIsActive: companies.isActive,
      })
      .from(companyRoleAssignments)
      .innerJoin(companies, eq(companyRoleAssignments.companyId, companies.id))
      .leftJoin(employees, eq(companyRoleAssignments.employeeId, employees.id))
      .where(
        and(
          eq(companyRoleAssignments.roleType, type),
          eq(companies.isActive, true),
          projectId ? eq(companies.projectId, projectId) : undefined,
          or(isNull(companyRoleAssignments.certificateEndDate), gte(companyRoleAssignments.certificateEndDate, now))
        )
      );

    const companyIds = [...new Set(assignmentRows.map((r) => r.companyId))];

    let employeeCountByCompany = new Map();
    let lastKurulByCompany = new Map();
    let docCountByCompany = new Map();
    let expiredDocCountByCompany = new Map();
    let incidentCountsByCompany = new Map();
    let nonconformityCountsByCompany = new Map();

    if (companyIds.length > 0) {
      const [empRows, kurulRows, docRows, incidentRows, ncRows] = await Promise.all([
        db
          .select({ companyId: employees.companyId, count: sql`count(*)`.mapWith(Number) })
          .from(employees)
          .where(and(inArray(employees.companyId, companyIds), eq(employees.isActive, true)))
          .groupBy(employees.companyId),
        db
          .select({ companyId: boardMeetings.companyId, lastDate: sql`max(${boardMeetings.meetingDate})` })
          .from(boardMeetings)
          .where(inArray(boardMeetings.companyId, companyIds))
          .groupBy(boardMeetings.companyId),
        db
          .select({
            companyId: companyDocuments.companyId,
            count: sql`count(*)`.mapWith(Number),
            expiredCount: sql`count(*) filter (where ${companyDocuments.validUntil} is not null and ${companyDocuments.validUntil} < now())`.mapWith(Number),
          })
          .from(companyDocuments)
          .where(inArray(companyDocuments.companyId, companyIds))
          .groupBy(companyDocuments.companyId),
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
          .select({
            companyId: nonconformities.companyId,
            openCount: sql`count(*) filter (where ${nonconformities.status} in ('ACIK', 'BEKLEMEDE'))`.mapWith(Number),
            closedCount: sql`count(*) filter (where ${nonconformities.status} = 'KAPALI')`.mapWith(Number),
          })
          .from(nonconformities)
          .where(inArray(nonconformities.companyId, companyIds))
          .groupBy(nonconformities.companyId),
      ]);
      employeeCountByCompany = new Map(empRows.map((r) => [r.companyId, r.count]));
      lastKurulByCompany = new Map(kurulRows.map((r) => [r.companyId, r.lastDate]));
      docCountByCompany = new Map(docRows.map((r) => [r.companyId, r.count]));
      expiredDocCountByCompany = new Map(docRows.map((r) => [r.companyId, r.expiredCount]));
      incidentCountsByCompany = new Map(incidentRows.map((r) => [r.companyId, { kazaCount: r.kazaCount, ramakKalaCount: r.ramakKalaCount }]));
      nonconformityCountsByCompany = new Map(ncRows.map((r) => [r.companyId, { openCount: r.openCount, closedCount: r.closedCount }]));
    }

    function companyStats(companyId) {
      const employeeCount = employeeCountByCompany.get(companyId) || 0;
      const inc = incidentCountsByCompany.get(companyId) || { kazaCount: 0, ramakKalaCount: 0 };
      const nc = nonconformityCountsByCompany.get(companyId) || { openCount: 0, closedCount: 0 };
      return {
        employeeCount,
        lastKurulDate: lastKurulByCompany.get(companyId) || null,
        documentCount: docCountByCompany.get(companyId) || 0,
        expiredDocumentCount: expiredDocCountByCompany.get(companyId) || 0,
        kazaCount: inc.kazaCount,
        ramakKalaCount: inc.ramakKalaCount,
        nonconformityOpenCount: nc.openCount,
        nonconformityClosedCount: nc.closedCount,
      };
    }

    // Kişi bazında grupla (aynı kişi birden fazla firmaya atanmış olabilir).
    const peopleMap = new Map();
    for (const row of assignmentRows) {
      const key = personKey(row);
      if (!peopleMap.has(key)) {
        peopleMap.set(key, {
          key,
          fullName: row.source === 'CALISAN' ? row.employeeFullName : row.outsideFullName,
          source: row.source,
          assignments: [],
        });
      }
      peopleMap.get(key).assignments.push(row);
    }

    const people = [...peopleMap.values()].map((person) => {
      // En güncel (createdAt en yeni) atamadan sertifika bilgisi alınır; başlama tarihi olarak
      // aktif atamalar arasındaki en erken certificateStartDate kullanılır (bkz. kullanıcı isteği
      // "hangi tarihte işe başladığı").
      const sortedByCreated = [...person.assignments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const latest = sortedByCreated[0];
      const startDates = person.assignments.map((a) => a.certificateStartDate).filter(Boolean).map((d) => new Date(d));
      const startDate = startDates.length > 0 ? new Date(Math.min(...startDates.map((d) => d.getTime()))) : null;

      const companiesForPerson = person.assignments.map((a) => {
        const stats = companyStats(a.companyId);
        return {
          companyId: a.companyId,
          companyName: a.companyName,
          dangerClass: a.companyDangerClass,
          certificateStartDate: a.certificateStartDate,
          certificateEndDate: a.certificateEndDate,
          ...stats,
        };
      });

      const dangerClassEmployeeCounts = { AZ_TEHLIKELI: 0, TEHLIKELI: 0, COK_TEHLIKELI: 0 };
      let requiredMonthlyMinutes = 0;
      let totalIncidents = 0;
      let nonconformityOpenTotal = 0;
      let nonconformityClosedTotal = 0;
      const minutesTable = MINUTES_PER_EMPLOYEE_PER_MONTH[type];
      for (const c of companiesForPerson) {
        if (c.dangerClass && dangerClassEmployeeCounts[c.dangerClass] !== undefined) {
          dangerClassEmployeeCounts[c.dangerClass] += c.employeeCount;
          requiredMonthlyMinutes += c.employeeCount * (minutesTable[c.dangerClass] || 0);
        }
        totalIncidents += c.kazaCount + c.ramakKalaCount;
        nonconformityOpenTotal += c.nonconformityOpenCount;
        nonconformityClosedTotal += c.nonconformityClosedCount;
      }

      let classAdequacy = null;
      if (type === 'ISG_UZMANI' && latest.certificateClass) {
        const allowed = ISG_UZMANI_CLASS_ALLOWED_DANGER_CLASSES[latest.certificateClass];
        if (allowed) {
          const uncovered = companiesForPerson.filter((c) => c.dangerClass && !allowed.includes(c.dangerClass));
          classAdequacy = {
            adequate: uncovered.length === 0,
            uncoveredCompanies: uncovered.map((c) => ({ companyId: c.companyId, companyName: c.companyName, dangerClass: c.dangerClass })),
          };
        }
      }

      return {
        key: person.key,
        fullName: person.fullName,
        source: person.source,
        outsideCompanyName: latest.outsideCompanyName,
        outsidePhone: latest.outsidePhone,
        certificateNo: latest.certificateNo,
        certificateClass: latest.certificateClass,
        startDate,
        companyCount: companiesForPerson.length,
        totalEmployees: companiesForPerson.reduce((sum, c) => sum + c.employeeCount, 0),
        dangerClassEmployeeCounts,
        requiredMonthlyMinutes,
        totalIncidents,
        nonconformityOpenTotal,
        nonconformityClosedTotal,
        classAdequacy,
        companies: companiesForPerson,
      };
    });

    people.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'tr'));

    // Sayfa üstü toplam özet: bu tipte (uzman/hekim) en az bir aktif ataması olan tekil
    // firmalar üzerinden hesaplanır (aynı firmaya birden fazla kişi atanmışsa firma bir kez sayılır).
    const distinctCompanyRows = new Map();
    for (const row of assignmentRows) {
      if (!distinctCompanyRows.has(row.companyId)) {
        distinctCompanyRows.set(row.companyId, { dangerClass: row.companyDangerClass, companyId: row.companyId });
      }
    }
    const summaryDangerClassCompanyCounts = { AZ_TEHLIKELI: 0, TEHLIKELI: 0, COK_TEHLIKELI: 0 };
    const summaryDangerClassEmployeeCounts = { AZ_TEHLIKELI: 0, TEHLIKELI: 0, COK_TEHLIKELI: 0 };
    let summaryTotalIncidents = 0;
    let summaryRequiredMonthlyMinutes = 0;
    const minutesTable = MINUTES_PER_EMPLOYEE_PER_MONTH[type];
    for (const { dangerClass, companyId } of distinctCompanyRows.values()) {
      const stats = companyStats(companyId);
      summaryTotalIncidents += stats.kazaCount + stats.ramakKalaCount;
      if (dangerClass && summaryDangerClassCompanyCounts[dangerClass] !== undefined) {
        summaryDangerClassCompanyCounts[dangerClass] += 1;
        summaryDangerClassEmployeeCounts[dangerClass] += stats.employeeCount;
        summaryRequiredMonthlyMinutes += stats.employeeCount * (minutesTable[dangerClass] || 0);
      }
    }

    res.json({
      type,
      summary: {
        totalCompanies: distinctCompanyRows.size,
        totalPeople: people.length,
        dangerClassCompanyCounts: summaryDangerClassCompanyCounts,
        dangerClassEmployeeCounts: summaryDangerClassEmployeeCounts,
        totalEmployees: Object.values(summaryDangerClassEmployeeCounts).reduce((a, b) => a + b, 0),
        totalIncidents: summaryTotalIncidents,
        requiredMonthlyMinutes: summaryRequiredMonthlyMinutes,
      },
      people,
    });
  })
);

module.exports = router;
