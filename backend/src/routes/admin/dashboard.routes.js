const express = require('express');
const { eq, and, inArray, sql } = require('drizzle-orm');
const { db } = require('../../db/client');
const { projects, companies, employees, incidents, nonconformities } = require('../../db/schema');
const { asyncHandler } = require('../../utils/asyncHandler');
const { requirePermission } = require('../../middleware/permission');

const router = express.Router();

// Ana sayfadaki (DashboardPage.jsx) admin özet paneli için - salt görüntüleme, yazma işlemi yok.
// Proje/firma/kullanıcı yönetimiyle ilgilenen herhangi bir yetkiye sahip kişi bu özeti görebilmeli.
const VIEW_PERMISSIONS = [
  'proje_yonetme', 'firma_yonetme', 'firma_goruntuleme', 'gecici_gorevlendirme_yonetimi',
  'rapor_goruntuleme', 'kullanici_yonetme', 'insan_kaynaklari_yonetimi',
];

router.get(
  '/',
  requirePermission(VIEW_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const projectRows = await db
      .select({ id: projects.id, name: projects.name, code: projects.code, status: projects.status })
      .from(projects)
      .orderBy(projects.status, projects.name);

    const projectIds = projectRows.map((p) => p.id);

    let companyCountByProject = new Map();
    let employeeCountByProject = new Map();
    let incidentCountsByProject = new Map();
    let nonconformityCountsByProject = new Map();

    if (projectIds.length > 0) {
      const [companyRows, employeeRows, ncRows, companiesForIncidents] = await Promise.all([
        db
          .select({ projectId: companies.projectId, count: sql`count(*)`.mapWith(Number) })
          .from(companies)
          .where(and(inArray(companies.projectId, projectIds), eq(companies.isActive, true)))
          .groupBy(companies.projectId),
        db
          .select({ projectId: employees.projectId, count: sql`count(*)`.mapWith(Number) })
          .from(employees)
          .where(and(inArray(employees.projectId, projectIds), eq(employees.isActive, true)))
          .groupBy(employees.projectId),
        db
          .select({
            projectId: nonconformities.projectId,
            openCount: sql`count(*) filter (where ${nonconformities.status} in ('ACIK', 'BEKLEMEDE'))`.mapWith(Number),
            closedCount: sql`count(*) filter (where ${nonconformities.status} = 'KAPALI')`.mapWith(Number),
          })
          .from(nonconformities)
          .where(inArray(nonconformities.projectId, projectIds))
          .groupBy(nonconformities.projectId),
        // incidents tablosunda projectId yok - companies üzerinden proje eşlemesi çıkarılır.
        db.select({ id: companies.id, projectId: companies.projectId }).from(companies).where(inArray(companies.projectId, projectIds)),
      ]);

      companyCountByProject = new Map(companyRows.map((r) => [r.projectId, r.count]));
      employeeCountByProject = new Map(employeeRows.map((r) => [r.projectId, r.count]));
      nonconformityCountsByProject = new Map(ncRows.map((r) => [r.projectId, { openCount: r.openCount, closedCount: r.closedCount }]));

      const companyIds = companiesForIncidents.map((c) => c.id);
      const projectIdByCompanyId = new Map(companiesForIncidents.map((c) => [c.id, c.projectId]));
      if (companyIds.length > 0) {
        const incidentRows = await db
          .select({
            companyId: incidents.companyId,
            kazaCount: sql`count(*) filter (where ${incidents.type} = 'KAZA')`.mapWith(Number),
            ramakKalaCount: sql`count(*) filter (where ${incidents.type} = 'RAMAK_KALA')`.mapWith(Number),
          })
          .from(incidents)
          .where(inArray(incidents.companyId, companyIds))
          .groupBy(incidents.companyId);
        for (const row of incidentRows) {
          const projectId = projectIdByCompanyId.get(row.companyId);
          if (!projectId) continue;
          const existing = incidentCountsByProject.get(projectId) || { kazaCount: 0, ramakKalaCount: 0 };
          existing.kazaCount += row.kazaCount;
          existing.ramakKalaCount += row.ramakKalaCount;
          incidentCountsByProject.set(projectId, existing);
        }
      }
    }

    const projectSummaries = projectRows.map((p) => {
      const inc = incidentCountsByProject.get(p.id) || { kazaCount: 0, ramakKalaCount: 0 };
      const nc = nonconformityCountsByProject.get(p.id) || { openCount: 0, closedCount: 0 };
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        companyCount: companyCountByProject.get(p.id) || 0,
        employeeCount: employeeCountByProject.get(p.id) || 0,
        kazaCount: inc.kazaCount,
        ramakKalaCount: inc.ramakKalaCount,
        nonconformityOpenCount: nc.openCount,
        nonconformityClosedCount: nc.closedCount,
      };
    });

    const totals = projectSummaries.reduce(
      (acc, p) => ({
        projectCount: acc.projectCount + 1,
        companyCount: acc.companyCount + p.companyCount,
        employeeCount: acc.employeeCount + p.employeeCount,
        kazaCount: acc.kazaCount + p.kazaCount,
        ramakKalaCount: acc.ramakKalaCount + p.ramakKalaCount,
        nonconformityOpenCount: acc.nonconformityOpenCount + p.nonconformityOpenCount,
        nonconformityClosedCount: acc.nonconformityClosedCount + p.nonconformityClosedCount,
      }),
      { projectCount: 0, companyCount: 0, employeeCount: 0, kazaCount: 0, ramakKalaCount: 0, nonconformityOpenCount: 0, nonconformityClosedCount: 0 }
    );

    res.json({ totals, projects: projectSummaries });
  })
);

module.exports = router;
