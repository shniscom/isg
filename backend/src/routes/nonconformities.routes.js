const express = require('express');
const { z } = require('zod');
const { eq, and, or, desc, gte, lte, ilike, isNull, isNotNull, inArray, count, sql } = require('drizzle-orm');
const { db } = require('../db/client');
const {
  nonconformities,
  nonconformityAssignees,
  nonconformityPhotos,
  nonconformityCorrections,
  nonconformityStatusHistory,
  users,
  projects,
  categories,
  projectBlocks,
  companies,
  userProjects,
  roles,
  employees,
  penalties,
  incidents,
  dueDateExtensions,
  permissions,
  userPermissions,
} = require('../db/schema');
const { createNotification, createNotifications } = require('../services/notification.service');
const { getSetting } = require('../services/settings.service');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireSystemAdmin } = require('../middleware/permission');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/apiError');
const { logAudit } = require('../utils/audit');
const { generateNonconformityNumber, logStatusChange, loadAssigneeIdsFor } = require('../services/nonconformity.service');
const { createViewUrl } = require('../services/storage.service');
const { runOrQueueForApproval } = require('../utils/approval');

const router = express.Router();
router.use(requireAuth);

/** İstekte bulunan kullanıcının çalışacağı proje id'sini belirler. */
function resolveProjectId(req, explicitProjectId) {
  if (req.user.isSystemAdmin) {
    if (!explicitProjectId) {
      throw ApiError.badRequest('Sistem admini için projectId parametresi zorunludur.');
    }
    return explicitProjectId;
  }
  if (!req.user.projectId) {
    throw ApiError.forbidden('Aktif bir proje bağlamınız yok. Lütfen tekrar giriş yapıp proje/görev seçin.');
  }
  return req.user.projectId;
}

function hasPermission(req, key) {
  return req.user.isSystemAdmin || (req.user.permissions || []).includes(key);
}

const photoInputSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['ACILIS', 'DUZELTME', 'ITIRAZ', 'CEZA', 'DIGER']).default('DIGER'),
  originalFileName: z.string().optional().nullable(),
});

async function attachPhotos(tx, { nonconformityId, correctionId, photos, uploadedById }) {
  if (!photos || photos.length === 0) return;
  await tx.insert(nonconformityPhotos).values(
    photos.map((p) => ({
      nonconformityId,
      correctionId: correctionId || null,
      type: p.type,
      objectKey: p.key,
      originalFileName: p.originalFileName || null,
      uploadedById,
    }))
  );
}

async function withPhotoViewUrls(photos) {
  return Promise.all(
    photos.map(async (p) => ({ ...p, viewUrl: await createViewUrl(p.objectKey).catch(() => null) }))
  );
}

/**
 * Verilen uygunsuzluk id listesi için atanan kişileri toplu olarak yükler ve id'ye göre gruplar.
 * Bir transaction (tx) içinden çağrılıyorsa mutlaka `executor` olarak `tx` verilmelidir; aksi halde
 * PGlite/Postgres üzerinde ayrı bir bağlantıdan sorgu açılıp aynı transaction'ı bekleterek kilitlenmeye
 * (deadlock) yol açabilir.
 */
async function loadAssigneesFor(nonconformityIds, executor = db) {
  if (!nonconformityIds || nonconformityIds.length === 0) return {};
  const rows = await executor
    .select({
      nonconformityId: nonconformityAssignees.nonconformityId,
      userId: users.id,
      fullName: users.fullName,
    })
    .from(nonconformityAssignees)
    .innerJoin(users, eq(nonconformityAssignees.userId, users.id))
    .where(inArray(nonconformityAssignees.nonconformityId, nonconformityIds));

  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.nonconformityId]) grouped[row.nonconformityId] = [];
    grouped[row.nonconformityId].push({ userId: row.userId, fullName: row.fullName });
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Açma formu için referans veriler (kategori/blok/firma) - admin panelindeki
// yönetim uçlarından bağımsız, salt okunur ve proje bağlamına göre filtrelenmiş.
// ---------------------------------------------------------------------------
router.get(
  '/reference-data',
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);
    if (!hasPermission(req, 'uygunsuzluk_acma') && !hasPermission(req, 'uygunsuzluk_gorme')) {
      throw ApiError.forbidden();
    }

    const [categoryRows, blockRows, companyRows] = await Promise.all([
      db
        .select()
        .from(categories)
        .where(and(or(eq(categories.projectId, projectId), isNull(categories.projectId)), eq(categories.isActive, true))),
      db.select().from(projectBlocks).where(eq(projectBlocks.projectId, projectId)),
      db.select().from(companies).where(and(eq(companies.projectId, projectId), eq(companies.isActive, true))),
    ]);

    res.json({ categories: categoryRows, blocks: blockRows, companies: companyRows });
  })
);

// ---------------------------------------------------------------------------
// Atanabilir kullanıcı listesi (uygunsuzluk açma formunda kullanılır)
// ---------------------------------------------------------------------------
router.get(
  '/assignable-users',
  requirePermission('uygunsuzluk_acma'),
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);
    // ?companyId= verilirse yalnızca o firmaya özel atanmış kişiler + proje genelinde (tüm
    // firmalar kapsamında) atanmış kişiler listelenir. companyId hiç gönderilmezse projedeki
    // TÜM atanmış kişiler (herhangi bir firma kapsamı) listelenir - "tüm kullanıcıları göster"
    // filtresi için kullanılır.
    const companyId = req.query.companyId || null;

    const conditions = [eq(userProjects.projectId, projectId), eq(userProjects.isActive, true), eq(users.isActive, true)];
    if (companyId) {
      conditions.push(or(eq(userProjects.companyId, companyId), isNull(userProjects.companyId)));
    }

    const rows = await db
      .select({
        userId: users.id,
        fullName: users.fullName,
        roleName: roles.name,
        companyId: userProjects.companyId,
        companyName: companies.name,
        blockId: userProjects.blockId,
        blockName: projectBlocks.name,
      })
      .from(userProjects)
      .innerJoin(users, eq(userProjects.userId, users.id))
      .innerJoin(roles, eq(userProjects.roleId, roles.id))
      .leftJoin(companies, eq(userProjects.companyId, companies.id))
      .leftJoin(projectBlocks, eq(userProjects.blockId, projectBlocks.id))
      .where(and(...conditions));

    // Aynı kullanıcının bu projede birden fazla ataması olabilir (ör. hem genel hem de belirli
    // bir firmaya/bölgeye özel). Listede tek satır göstermek için tekilleştirilir; istenen
    // firmaya özel eşleşme varsa o tercih edilir (daha net bir rol/kapsam/bölge ifade eder).
    const byUser = new Map();
    for (const row of rows) {
      const isRequestedCompanyMatch = companyId ? row.companyId === companyId : row.companyId !== null;
      const existing = byUser.get(row.userId);
      if (!existing || (isRequestedCompanyMatch && !existing._match)) {
        byUser.set(row.userId, {
          userId: row.userId,
          fullName: row.fullName,
          roleName: row.roleName,
          companyId: row.companyId,
          companyName: row.companyName,
          blockId: row.blockId,
          blockName: row.blockName,
          _match: isRequestedCompanyMatch,
        });
      }
    }

    const result = [...byUser.values()].map(({ _match, ...rest }) => rest);
    res.json({ users: result });
  })
);

// ---------------------------------------------------------------------------
// Firma bazlı özet (Uygunsuzluklar sayfasındaki firma kartları için). Kullanıcının genel
// görme yetkisi (uygunsuzluk_gorme / firma_yonetme / admin) varsa projedeki tüm firmalar
// kart olarak listelenir; yoksa yalnızca userProjects üzerinden kendisine bir firma
// kapsamında görev/rol atanmış firmalar listelenir - "kendi sorumlu olduğu firmalar".
// "Genel" toplamı, GET /nonconformities ile aynı görünürlük kuralına göre hesaplanır (kendi
// açtığı/atandığı ya da tam görme yetkisi varsa projedeki her şey).
// ---------------------------------------------------------------------------
router.get(
  '/company-summary',
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);
    if (!hasPermission(req, 'uygunsuzluk_acma') && !hasPermission(req, 'uygunsuzluk_gorme')) {
      throw ApiError.forbidden();
    }

    const canSeeAll = req.user.isSystemAdmin || hasPermission(req, 'uygunsuzluk_gorme') || hasPermission(req, 'firma_yonetme');

    let companyRows;
    if (canSeeAll) {
      companyRows = await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(and(eq(companies.projectId, projectId), eq(companies.isActive, true)));
    } else {
      const myCompanyAssignments = await db
        .selectDistinct({ companyId: userProjects.companyId })
        .from(userProjects)
        .where(
          and(
            eq(userProjects.userId, req.user.sub),
            eq(userProjects.projectId, projectId),
            eq(userProjects.isActive, true),
            isNotNull(userProjects.companyId)
          )
        );
      const myCompanyIds = myCompanyAssignments.map((r) => r.companyId);
      companyRows =
        myCompanyIds.length > 0
          ? await db
              .select({ id: companies.id, name: companies.name })
              .from(companies)
              .where(and(inArray(companies.id, myCompanyIds), eq(companies.isActive, true)))
          : [];
    }

    const companyIds = companyRows.map((c) => c.id);

    // Uygunsuzluk sayıları: GET /nonconformities ile birebir aynı görünürlük kısıtı uygulanır.
    const ncConditions = [eq(nonconformities.projectId, projectId)];
    if (!canSeeAll) {
      const myAssignments = await db
        .select({ nonconformityId: nonconformityAssignees.nonconformityId })
        .from(nonconformityAssignees)
        .where(eq(nonconformityAssignees.userId, req.user.sub));
      const myAssignedIds = myAssignments.map((a) => a.nonconformityId);
      ncConditions.push(
        myAssignedIds.length > 0
          ? or(inArray(nonconformities.id, myAssignedIds), eq(nonconformities.openedById, req.user.sub))
          : eq(nonconformities.openedById, req.user.sub)
      );
    }

    const ncRows = await db
      .select({ companyId: nonconformities.companyId, status: nonconformities.status, count: sql`count(*)`.mapWith(Number) })
      .from(nonconformities)
      .where(and(...ncConditions))
      .groupBy(nonconformities.companyId, nonconformities.status);

    const incidentRows =
      companyIds.length > 0
        ? await db
            .select({
              companyId: incidents.companyId,
              kazaCount: sql`count(*) filter (where ${incidents.type} = 'KAZA')`.mapWith(Number),
              ramakKalaCount: sql`count(*) filter (where ${incidents.type} = 'RAMAK_KALA')`.mapWith(Number),
            })
            .from(incidents)
            .where(inArray(incidents.companyId, companyIds))
            .groupBy(incidents.companyId)
        : [];

    const penaltyRows =
      companyIds.length > 0
        ? await db
            .select({ companyId: employees.companyId, count: sql`count(*)`.mapWith(Number) })
            .from(penalties)
            .innerJoin(employees, eq(penalties.employeeId, employees.id))
            .where(inArray(employees.companyId, companyIds))
            .groupBy(employees.companyId)
        : [];

    const emptyCounts = () => ({ ACIK: 0, BEKLEMEDE: 0, KAPALI: 0, total: 0 });

    const byCompany = new Map();
    for (const c of companyRows) {
      byCompany.set(c.id, { companyId: c.id, companyName: c.name, counts: emptyCounts(), kazaCount: 0, ramakKalaCount: 0, penaltyCount: 0 });
    }
    const overall = { counts: emptyCounts(), kazaCount: 0, ramakKalaCount: 0, penaltyCount: 0 };

    for (const row of ncRows) {
      overall.counts[row.status] = (overall.counts[row.status] || 0) + row.count;
      overall.counts.total += row.count;
      if (row.companyId && byCompany.has(row.companyId)) {
        const entry = byCompany.get(row.companyId);
        entry.counts[row.status] = (entry.counts[row.status] || 0) + row.count;
        entry.counts.total += row.count;
      }
    }
    for (const row of incidentRows) {
      overall.kazaCount += row.kazaCount;
      overall.ramakKalaCount += row.ramakKalaCount;
      if (byCompany.has(row.companyId)) {
        const entry = byCompany.get(row.companyId);
        entry.kazaCount = row.kazaCount;
        entry.ramakKalaCount = row.ramakKalaCount;
      }
    }
    for (const row of penaltyRows) {
      overall.penaltyCount += row.count;
      if (byCompany.has(row.companyId)) byCompany.get(row.companyId).penaltyCount = row.count;
    }

    res.json({ overall, companies: [...byCompany.values()] });
  })
);

// ---------------------------------------------------------------------------
// Rapor: günlük/haftalık/aylık özet istatistikler
// ---------------------------------------------------------------------------
function rangeStartDate(range) {
  const now = new Date();
  if (range === 'week') return new Date(now.getTime() - 7 * 86400000);
  if (range === 'month') return new Date(now.getTime() - 30 * 86400000);
  // 'today' (varsayılan): yerel günün başlangıcı
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

router.get(
  '/report',
  requirePermission('rapor_goruntuleme'),
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);
    const range = ['today', 'week', 'month', 'custom'].includes(req.query.range) ? req.query.range : 'today';

    let from;
    let to = null;
    if (range === 'custom') {
      if (!req.query.from || !req.query.to) {
        throw ApiError.badRequest('Özel tarih aralığı için "from" ve "to" parametreleri zorunludur.');
      }
      from = new Date(req.query.from);
      to = new Date(req.query.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        throw ApiError.badRequest('Geçersiz tarih aralığı.');
      }
    } else {
      from = rangeStartDate(range);
    }
    const createdCondition = to
      ? and(gte(nonconformities.createdAt, from), lte(nonconformities.createdAt, to))
      : gte(nonconformities.createdAt, from);
    const closedCondition = to
      ? and(gte(nonconformities.closedAt, from), lte(nonconformities.closedAt, to))
      : gte(nonconformities.closedAt, from);

    const myAssignedSubqueryRows = await db
      .select({ nonconformityId: nonconformityAssignees.nonconformityId })
      .from(nonconformityAssignees)
      .where(eq(nonconformityAssignees.userId, req.user.sub));
    const myAssignedIds = myAssignedSubqueryRows.map((r) => r.nonconformityId);

    const [[totalOpenedRow], [myOpenedRow]] = await Promise.all([
      db
        .select({ value: count() })
        .from(nonconformities)
        .where(and(eq(nonconformities.projectId, projectId), createdCondition)),
      db
        .select({ value: count() })
        .from(nonconformities)
        .where(
          and(
            eq(nonconformities.projectId, projectId),
            eq(nonconformities.openedById, req.user.sub),
            createdCondition
          )
        ),
    ]);

    let myAssignedCount = 0;
    let myClosedCount = 0;
    if (myAssignedIds.length > 0) {
      const [[assignedRow], [closedRow]] = await Promise.all([
        db
          .select({ value: count() })
          .from(nonconformities)
          .where(
            and(
              eq(nonconformities.projectId, projectId),
              inArray(nonconformities.id, myAssignedIds),
              createdCondition
            )
          ),
        db
          .select({ value: count() })
          .from(nonconformities)
          .where(
            and(
              eq(nonconformities.projectId, projectId),
              inArray(nonconformities.id, myAssignedIds),
              eq(nonconformities.status, 'KAPALI'),
              closedCondition
            )
          ),
      ]);
      myAssignedCount = assignedRow?.value || 0;
      myClosedCount = closedRow?.value || 0;
    }

    // Firma bazlı kırılım: bu dönemde açılan / kapatılan sayıları, ana firma dahil her firma için.
    const openedByCompanyRows = await db
      .select({ companyId: nonconformities.companyId, value: count() })
      .from(nonconformities)
      .where(and(eq(nonconformities.projectId, projectId), createdCondition))
      .groupBy(nonconformities.companyId);
    const closedByCompanyRows = await db
      .select({ companyId: nonconformities.companyId, value: count() })
      .from(nonconformities)
      .where(
        and(
          eq(nonconformities.projectId, projectId),
          eq(nonconformities.status, 'KAPALI'),
          closedCondition
        )
      )
      .groupBy(nonconformities.companyId);

    const allCompanyIds = [
      ...new Set([...openedByCompanyRows.map((r) => r.companyId), ...closedByCompanyRows.map((r) => r.companyId)].filter(Boolean)),
    ];
    const companyRows = allCompanyIds.length
      ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, allCompanyIds))
      : [];
    const companyNameById = new Map(companyRows.map((c) => [c.id, c.name]));
    const closedByCompany = new Map(closedByCompanyRows.map((r) => [r.companyId, r.value]));

    const companyBreakdown = openedByCompanyRows
      .map((r) => ({
        companyId: r.companyId,
        companyName: r.companyId ? companyNameById.get(r.companyId) || 'Bilinmeyen Firma' : 'Firma Belirtilmemiş',
        opened: r.value,
        closed: closedByCompany.get(r.companyId) || 0,
      }))
      .sort((a, b) => b.opened - a.opened);

    res.json({
      range,
      from: from.toISOString(),
      to: to ? to.toISOString() : null,
      totalOpened: totalOpenedRow?.value || 0,
      myOpened: myOpenedRow?.value || 0,
      myAssigned: myAssignedCount,
      myClosed: myClosedCount,
      companyBreakdown,
    });
  })
);

/**
 * Admin için tam kayıt dışa aktarımı: seçilen tarih aralığında (createdAt'e göre) açılmış tüm
 * uygunsuzlukları, ilgili tüm alanlarıyla (firma, kategori, açan, atananlar vb.) birlikte
 * JSON olarak döner; frontend bunu CSV'ye çevirip indirir. Yalnızca sistem admini kullanabilir.
 */
router.get(
  '/full-export',
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId;
    if (!projectId) throw ApiError.badRequest('projectId parametresi zorunludur.');
    if (!req.query.from || !req.query.to) throw ApiError.badRequest('"from" ve "to" parametreleri zorunludur.');

    const from = new Date(req.query.from);
    const to = new Date(req.query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw ApiError.badRequest('Geçersiz tarih aralığı.');
    }

    const rows = await db
      .select()
      .from(nonconformities)
      .where(and(eq(nonconformities.projectId, projectId), gte(nonconformities.createdAt, from), lte(nonconformities.createdAt, to)))
      .orderBy(nonconformities.createdAt);

    if (rows.length === 0) {
      return res.json({ nonconformities: [] });
    }

    const ncIds = rows.map((r) => r.id);
    const [categoryRows, blockRows, companyRows, userRows, assigneeRows] = await Promise.all([
      db.select().from(categories).where(eq(categories.projectId, projectId)),
      db.select().from(projectBlocks).where(eq(projectBlocks.projectId, projectId)),
      db.select().from(companies).where(eq(companies.projectId, projectId)),
      db.select({ id: users.id, fullName: users.fullName }).from(users),
      db.select().from(nonconformityAssignees).where(inArray(nonconformityAssignees.nonconformityId, ncIds)),
    ]);
    const categoryNameById = new Map(categoryRows.map((c) => [c.id, c.name]));
    const blockNameById = new Map(blockRows.map((b) => [b.id, b.name]));
    const companyNameById = new Map(companyRows.map((c) => [c.id, c.name]));
    const userNameById = new Map(userRows.map((u) => [u.id, u.fullName]));
    const assigneesByNc = new Map();
    for (const a of assigneeRows) {
      const list = assigneesByNc.get(a.nonconformityId) || [];
      list.push(userNameById.get(a.userId) || a.userId);
      assigneesByNc.set(a.nonconformityId, list);
    }

    const result = rows.map((nc) => ({
      number: nc.number,
      status: nc.status,
      priority: nc.priority,
      description: nc.description,
      categoryName: nc.categoryId ? categoryNameById.get(nc.categoryId) || null : null,
      blockName: nc.blockId ? blockNameById.get(nc.blockId) || null : null,
      companyName: nc.companyId ? companyNameById.get(nc.companyId) || null : null,
      openedByName: userNameById.get(nc.openedById) || null,
      assigneeNames: (assigneesByNc.get(nc.id) || []).join('; '),
      createdAt: nc.createdAt,
      dueDate: nc.dueDate,
      closedAt: nc.closedAt,
    }));

    res.json({ nonconformities: result });
  })
);

// ---------------------------------------------------------------------------
// Listeleme
// ---------------------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);
    const canSeeAll = hasPermission(req, 'uygunsuzluk_gorme');

    const conditions = [eq(nonconformities.projectId, projectId)];

    if (!canSeeAll && !req.user.isSystemAdmin) {
      // Genel görme yetkisi yoksa yalnızca kendi açtığı veya kendisine atanan kayıtları görebilir.
      const myAssignments = await db
        .select({ nonconformityId: nonconformityAssignees.nonconformityId })
        .from(nonconformityAssignees)
        .where(eq(nonconformityAssignees.userId, req.user.sub));
      const myAssignedIds = myAssignments.map((a) => a.nonconformityId);
      conditions.push(
        myAssignedIds.length > 0
          ? or(inArray(nonconformities.id, myAssignedIds), eq(nonconformities.openedById, req.user.sub))
          : eq(nonconformities.openedById, req.user.sub)
      );
    }

    if (req.query.status) conditions.push(eq(nonconformities.status, req.query.status));
    if (req.query.categoryId) conditions.push(eq(nonconformities.categoryId, req.query.categoryId));
    if (req.query.blockId) conditions.push(eq(nonconformities.blockId, req.query.blockId));
    if (req.query.companyId) conditions.push(eq(nonconformities.companyId, req.query.companyId));
    if (req.query.assignedUserId) {
      const filterRows = await db
        .select({ nonconformityId: nonconformityAssignees.nonconformityId })
        .from(nonconformityAssignees)
        .where(eq(nonconformityAssignees.userId, req.query.assignedUserId));
      const filterIds = filterRows.map((r) => r.nonconformityId);
      conditions.push(filterIds.length > 0 ? inArray(nonconformities.id, filterIds) : eq(nonconformities.id, '__none__'));
    }
    if (req.query.openedById) conditions.push(eq(nonconformities.openedById, req.query.openedById));
    if (req.query.search) conditions.push(ilike(nonconformities.number, `%${req.query.search}%`));
    if (req.query.dateFrom) conditions.push(gte(nonconformities.createdAt, new Date(req.query.dateFrom)));
    if (req.query.dateTo) conditions.push(lte(nonconformities.createdAt, new Date(req.query.dateTo)));

    const rows = await db
      .select({
        id: nonconformities.id,
        number: nonconformities.number,
        status: nonconformities.status,
        priority: nonconformities.priority,
        description: nonconformities.description,
        dueDate: nonconformities.dueDate,
        createdAt: nonconformities.createdAt,
        closedAt: nonconformities.closedAt,
        categoryName: categories.name,
        blockName: projectBlocks.name,
        companyName: companies.name,
        openedById: nonconformities.openedById,
      })
      .from(nonconformities)
      .leftJoin(categories, eq(nonconformities.categoryId, categories.id))
      .leftJoin(projectBlocks, eq(nonconformities.blockId, projectBlocks.id))
      .leftJoin(companies, eq(nonconformities.companyId, companies.id))
      .where(and(...conditions))
      .orderBy(desc(nonconformities.createdAt));

    const assigneesByNc = await loadAssigneesFor(rows.map((r) => r.id));
    const rowsWithAssignees = rows.map((r) => ({ ...r, assignees: assigneesByNc[r.id] || [] }));

    res.json({ nonconformities: rowsWithAssignees });
  })
);

// ---------------------------------------------------------------------------
// Oluşturma (Uygunsuzluk Açma)
// ---------------------------------------------------------------------------
const createSchema = z.object({
  projectId: z.string().optional(), // sadece admin için gerekli
  categoryId: z.string().optional().nullable(),
  blockId: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  employeeId: z.string().optional().nullable(), // uygunsuz davranışta bulunan çalışan
  assignedUserIds: z.array(z.string().min(1)).min(1, 'En az bir atanan kişi seçilmelidir.'),
  description: z.string().min(5, 'Açıklama en az 5 karakter olmalıdır.'),
  correctionSuggestion: z.string().optional().nullable(),
  riskScore: z.number().int().min(1).max(5).optional().nullable(),
  priority: z.enum(['DUSUK', 'ORTA', 'YUKSEK', 'KRITIK']).default('ORTA'),
  dueDate: z.string().datetime({ message: 'Geçerli bir termin tarihi giriniz.' }),
  photos: z.array(photoInputSchema).optional().default([]),
});

router.post(
  '/',
  requirePermission('uygunsuzluk_acma'),
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz uygunsuzluk bilgisi.', parsed.error.flatten());
    const data = parsed.data;
    const projectId = resolveProjectId(req, data.projectId);

    const maxPhotos = await getSetting('maxPhotosPerUpload', 5);
    if (data.photos.length > maxPhotos) {
      throw ApiError.badRequest(`En fazla ${maxPhotos} fotoğraf yükleyebilirsiniz.`);
    }

    const dueDate = new Date(data.dueDate);
    if (dueDate.getTime() <= Date.now()) {
      throw ApiError.badRequest('Termin tarihi bugünden ileri bir tarih olmalıdır.');
    }

    const uniqueAssignedUserIds = [...new Set(data.assignedUserIds)];
    const assignedMembers = await db
      .select({ userId: userProjects.userId })
      .from(userProjects)
      .where(
        and(
          inArray(userProjects.userId, uniqueAssignedUserIds),
          eq(userProjects.projectId, projectId),
          eq(userProjects.isActive, true)
        )
      );
    const validAssignedIds = new Set(assignedMembers.map((m) => m.userId));
    const invalidIds = uniqueAssignedUserIds.filter((uid) => !validAssignedIds.has(uid));
    if (invalidIds.length > 0) {
      throw ApiError.badRequest('Atanan kullanıcılardan bazıları bu projeye atanmamış veya pasif.');
    }
    // Bir kişi kendi açtığı uygunsuzluğun sorumlusu olarak kendisini atayamaz (denetim/kontrol
    // amacıyla açan ile sorumlu farklı kişiler olmalıdır).
    if (uniqueAssignedUserIds.includes(req.user.sub)) {
      throw ApiError.badRequest('Uygunsuzluğu açan kişi, kendisini sorumlu olarak atayamaz.');
    }

    const result = await db.transaction(async (tx) => {
      const number = await generateNonconformityNumber(tx, projectId);

      const [created] = await tx
        .insert(nonconformities)
        .values({
          number,
          projectId,
          categoryId: data.categoryId || null,
          blockId: data.blockId || null,
          companyId: data.companyId || null,
          employeeId: data.employeeId || null,
          openedById: req.user.sub,
          description: data.description,
          correctionSuggestion: data.correctionSuggestion || null,
          riskScore: data.riskScore || null,
          priority: data.priority,
          dueDate,
        })
        .returning();

      await tx.insert(nonconformityAssignees).values(
        uniqueAssignedUserIds.map((userId) => ({ nonconformityId: created.id, userId }))
      );

      await attachPhotos(tx, {
        nonconformityId: created.id,
        photos: data.photos.map((p) => ({ ...p, type: 'ACILIS' })),
        uploadedById: req.user.sub,
      });

      await logStatusChange(tx, {
        nonconformityId: created.id,
        fromStatus: null,
        toStatus: 'ACIK',
        actorId: req.user.sub,
        note: 'Uygunsuzluk oluşturuldu.',
      });

      await createNotifications(tx, {
        userIds: uniqueAssignedUserIds,
        nonconformityId: created.id,
        title: 'Size bir uygunsuzluk atandı',
        message: `${created.number} numaralı uygunsuzluk size atandı.`,
      });

      return created;
    });

    await logAudit({
      userId: req.user.sub,
      action: 'NONCONFORMITY_CREATE',
      entityType: 'nonconformity',
      entityId: result.id,
      details: { number: result.number, assignedUserIds: uniqueAssignedUserIds },
      ipAddress: req.ip,
    });

    res.status(201).json({ nonconformity: result });
  })
);

// ---------------------------------------------------------------------------
// Düzenleme ve silme: yalnızca admin veya uygunsuzluğu açan kişi yapabilir. Bu, test/deneme
// sürecinde yanlış girilen kayıtların düzeltilebilmesi ve gereksiz kayıtların temizlenebilmesi
// için eklenmiştir. Silme, kapatılmış (KAPALI) kayıtlar için yalnızca admin tarafından
// yapılabilir - açan kişi denetim izini bozmasın diye kapanmış bir kaydı silemez.
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  categoryId: z.string().optional().nullable(),
  blockId: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  employeeId: z.string().optional().nullable(),
  description: z.string().min(5, 'Açıklama en az 5 karakter olmalıdır.').optional(),
  correctionSuggestion: z.string().optional().nullable(),
  riskScore: z.number().int().min(1).max(5).optional().nullable(),
  priority: z.enum(['DUSUK', 'ORTA', 'YUKSEK', 'KRITIK']).optional(),
  dueDate: z.string().datetime({ message: 'Geçerli bir termin tarihi giriniz.' }).optional(),
  assignedUserIds: z.array(z.string().min(1)).min(1, 'En az bir atanan kişi seçilmelidir.').optional(),
});

async function loadEditableNonconformity(req) {
  const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
  if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');
  if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();
  const canEdit = req.user.isSystemAdmin || nc.openedById === req.user.sub;
  if (!canEdit) throw ApiError.forbidden('Bu uygunsuzluğu yalnızca admin veya açan kişi düzenleyebilir/silebilir.');
  return nc;
}

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const nc = await loadEditableNonconformity(req);

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz uygunsuzluk bilgisi.', parsed.error.flatten());
    const data = parsed.data;

    let dueDate;
    if (data.dueDate) {
      dueDate = new Date(data.dueDate);
    }

    let uniqueAssignedUserIds;
    if (data.assignedUserIds) {
      uniqueAssignedUserIds = [...new Set(data.assignedUserIds)];
      if (uniqueAssignedUserIds.includes(nc.openedById)) {
        throw ApiError.badRequest('Uygunsuzluğu açan kişi, kendisini sorumlu olarak atayamaz.');
      }
      const assignedMembers = await db
        .select({ userId: userProjects.userId })
        .from(userProjects)
        .where(and(inArray(userProjects.userId, uniqueAssignedUserIds), eq(userProjects.projectId, nc.projectId), eq(userProjects.isActive, true)));
      const validAssignedIds = new Set(assignedMembers.map((m) => m.userId));
      const invalidIds = uniqueAssignedUserIds.filter((uid) => !validAssignedIds.has(uid));
      if (invalidIds.length > 0) throw ApiError.badRequest('Atanan kullanıcılardan bazıları bu projeye atanmamış veya pasif.');
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(nonconformities)
        .set({
          ...(data.categoryId !== undefined ? { categoryId: data.categoryId || null } : {}),
          ...(data.blockId !== undefined ? { blockId: data.blockId || null } : {}),
          ...(data.companyId !== undefined ? { companyId: data.companyId || null } : {}),
          ...(data.employeeId !== undefined ? { employeeId: data.employeeId || null } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.correctionSuggestion !== undefined ? { correctionSuggestion: data.correctionSuggestion || null } : {}),
          ...(data.riskScore !== undefined ? { riskScore: data.riskScore || null } : {}),
          ...(data.priority !== undefined ? { priority: data.priority } : {}),
          ...(dueDate ? { dueDate } : {}),
          updatedAt: new Date(),
        })
        .where(eq(nonconformities.id, nc.id))
        .returning();

      if (uniqueAssignedUserIds) {
        await tx.delete(nonconformityAssignees).where(eq(nonconformityAssignees.nonconformityId, nc.id));
        await tx.insert(nonconformityAssignees).values(uniqueAssignedUserIds.map((userId) => ({ nonconformityId: nc.id, userId })));
      }

      return row;
    });

    await logAudit({
      userId: req.user.sub,
      action: 'NONCONFORMITY_UPDATE',
      entityType: 'nonconformity',
      entityId: nc.id,
      details: data,
      ipAddress: req.ip,
    });

    res.json({ nonconformity: updated });
  })
);

// Uygunsuzluk silme kritik/geri dönülmezdir (bkz. utils/approval.js). Admin isteği anında
// uygular; admin olmayan biri (açan kişi) isterse istek admin onayına kuyruğa alınır ve yalnızca
// admin onaylarsa services/criticalActions.service.js -> NONCONFORMITY_DELETE üzerinden silinir.
// Not: Eskiden "kapatılmış bir kaydı yalnızca admin silebilir" kuralı vardı; artık admin onay
// mekanizması zaten aynı korumayı (kapalı kayıtların da son sözü admin'de) sağladığı için bu
// özel kısıtlama kaldırıldı - açan kişi kapalı bir kaydın silinmesini talep edebilir, ama
// silme yalnızca admin onaylarsa gerçekleşir.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const nc = await loadEditableNonconformity(req);

    await runOrQueueForApproval(req, res, {
      actionType: 'NONCONFORMITY_DELETE',
      entityType: 'nonconformity',
      entityId: nc.id,
      payload: { nonconformityId: nc.id },
      summary: `${nc.number} numaralı uygunsuzluk kalıcı olarak silinecek.`,
      projectId: nc.projectId,
    });
  })
);

// ---------------------------------------------------------------------------
// Detay
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
    if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');

    const assigneesByNc = await loadAssigneesFor([nc.id]);
    const assignees = assigneesByNc[nc.id] || [];

    if (!req.user.isSystemAdmin) {
      if (nc.projectId !== req.user.projectId) throw ApiError.forbidden();
      const canSeeAll = hasPermission(req, 'uygunsuzluk_gorme');
      const isOwnerOrAssignee = assignees.some((a) => a.userId === req.user.sub) || nc.openedById === req.user.sub;
      if (!canSeeAll && !isOwnerOrAssignee) throw ApiError.forbidden();
    }

    const [project, category, block, company, openedBy, employee] = await Promise.all([
      db.select().from(projects).where(eq(projects.id, nc.projectId)).limit(1).then((r) => r[0]),
      nc.categoryId ? db.select().from(categories).where(eq(categories.id, nc.categoryId)).limit(1).then((r) => r[0]) : null,
      nc.blockId ? db.select().from(projectBlocks).where(eq(projectBlocks.id, nc.blockId)).limit(1).then((r) => r[0]) : null,
      nc.companyId ? db.select().from(companies).where(eq(companies.id, nc.companyId)).limit(1).then((r) => r[0]) : null,
      db.select().from(users).where(eq(users.id, nc.openedById)).limit(1).then((r) => r[0]),
      nc.employeeId ? db.select().from(employees).where(eq(employees.id, nc.employeeId)).limit(1).then((r) => r[0]) : null,
    ]);

    const photosRaw = await db.select().from(nonconformityPhotos).where(eq(nonconformityPhotos.nonconformityId, nc.id));
    const photos = await withPhotoViewUrls(photosRaw);

    const correctionsRaw = await db
      .select()
      .from(nonconformityCorrections)
      .where(eq(nonconformityCorrections.nonconformityId, nc.id))
      .orderBy(desc(nonconformityCorrections.submittedAt));

    const corrections = await Promise.all(
      correctionsRaw.map(async (c) => {
        const [submittedBy] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, c.submittedById)).limit(1);
        const reviewedBy = c.reviewedById
          ? await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, c.reviewedById)).limit(1).then((r) => r[0])
          : null;
        const correctionPhotos = await withPhotoViewUrls(
          await db.select().from(nonconformityPhotos).where(eq(nonconformityPhotos.correctionId, c.id))
        );
        return {
          ...c,
          submittedByName: submittedBy?.fullName || null,
          reviewedByName: reviewedBy?.fullName || null,
          photos: correctionPhotos,
        };
      })
    );

    const history = await db
      .select()
      .from(nonconformityStatusHistory)
      .where(eq(nonconformityStatusHistory.nonconformityId, nc.id))
      .orderBy(nonconformityStatusHistory.createdAt);

    const historyWithActors = await Promise.all(
      history.map(async (h) => {
        const [actor] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, h.actorId)).limit(1);
        return { ...h, actorName: actor?.fullName || null };
      })
    );

    const penaltyRows = await db
      .select()
      .from(penalties)
      .where(eq(penalties.nonconformityId, nc.id))
      .orderBy(desc(penalties.requestedAt));
    const ncPenalties = await Promise.all(
      penaltyRows.map(async (p) => {
        const [requestedBy] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, p.requestedById)).limit(1);
        const decidedBy = p.decidedById
          ? await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, p.decidedById)).limit(1).then((r) => r[0])
          : null;
        return { ...p, requestedByName: requestedBy?.fullName || null, decidedByName: decidedBy?.fullName || null };
      })
    );

    // Zaten onay bekleyen bir ceza talebi varsa yeniden talep açılamaz (aynı uygunsuzluk için
    // tek bir bekleyen talep olabilir).
    const hasPendingPenalty = penaltyRows.some((p) => p.status === 'BEKLEMEDE');

    // Ceza talebi oluşturma hakkı: termin geçmiş, hâlâ kapanmamış, açan kişi (ya da admin) ve
    // bekleyen bir talep yoksa.
    const canRequestPenalty =
      (req.user.isSystemAdmin || nc.openedById === req.user.sub) &&
      nc.status !== 'KAPALI' &&
      new Date(nc.dueDate).getTime() <= Date.now() &&
      !hasPendingPenalty;

    const extensionRows = await db
      .select()
      .from(dueDateExtensions)
      .where(eq(dueDateExtensions.nonconformityId, nc.id))
      .orderBy(desc(dueDateExtensions.requestedAt));
    const ncExtensions = await Promise.all(
      extensionRows.map(async (e) => {
        const [requestedBy] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, e.requestedById)).limit(1);
        const decidedBy = e.decidedById
          ? await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, e.decidedById)).limit(1).then((r) => r[0])
          : null;
        return { ...e, requestedByName: requestedBy?.fullName || null, decidedByName: decidedBy?.fullName || null };
      })
    );
    const hasPendingExtension = extensionRows.some((e) => e.status === 'BEKLEMEDE');
    const isAssignee = assignees.some((a) => a.userId === req.user.sub);
    const canRequestExtension = (isAssignee || req.user.isSystemAdmin) && nc.status !== 'KAPALI' && !hasPendingExtension;
    const canDecideExtension = req.user.isSystemAdmin || nc.openedById === req.user.sub;

    res.json({
      nonconformity: {
        ...nc,
        projectName: project?.name,
        categoryName: category?.name || null,
        blockName: block?.name || null,
        companyName: company?.name || null,
        openedByName: openedBy?.fullName,
        employeeName: employee?.fullName || null,
        employeeNationalId: employee?.nationalId || null,
        assignees,
        canRequestPenalty,
        hasPendingPenalty,
        canRequestExtension,
        hasPendingExtension,
        canDecideExtension,
      },
      photos,
      corrections,
      history: historyWithActors,
      penalties: ncPenalties,
      dueDateExtensions: ncExtensions,
    });
  })
);

// ---------------------------------------------------------------------------
// Düzeltme gönderme
// ---------------------------------------------------------------------------
const correctionSchema = z.object({
  description: z.string().min(5, 'Düzeltme açıklaması en az 5 karakter olmalıdır.'),
  photos: z.array(photoInputSchema).optional().default([]),
});

router.post(
  '/:id/corrections',
  asyncHandler(async (req, res) => {
    const parsed = correctionSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz düzeltme bilgisi.', parsed.error.flatten());

    const maxPhotos = await getSetting('maxPhotosPerUpload', 5);
    if (parsed.data.photos.length > maxPhotos) {
      throw ApiError.badRequest(`En fazla ${maxPhotos} fotoğraf yükleyebilirsiniz.`);
    }

    const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
    if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();

    const assigneesByNc = await loadAssigneesFor([nc.id]);
    const isAssignee = (assigneesByNc[nc.id] || []).some((a) => a.userId === req.user.sub);
    if (!isAssignee && !hasPermission(req, 'uygunsuzluk_duzeltme')) {
      throw ApiError.forbidden('Bu uygunsuzluğu yalnızca atanan kişilerden biri düzeltebilir.');
    }
    if (nc.status !== 'ACIK') {
      throw ApiError.conflict('Bu uygunsuzluk düzeltme göndermeye uygun durumda değil (durum: ' + nc.status + ').');
    }

    const result = await db.transaction(async (tx) => {
      const [correction] = await tx
        .insert(nonconformityCorrections)
        .values({ nonconformityId: nc.id, description: parsed.data.description, submittedById: req.user.sub })
        .returning();

      await attachPhotos(tx, {
        nonconformityId: nc.id,
        correctionId: correction.id,
        photos: parsed.data.photos.map((p) => ({ ...p, type: 'DUZELTME' })),
        uploadedById: req.user.sub,
      });

      await tx.update(nonconformities).set({ status: 'BEKLEMEDE', updatedAt: new Date() }).where(eq(nonconformities.id, nc.id));

      await logStatusChange(tx, {
        nonconformityId: nc.id,
        fromStatus: 'ACIK',
        toStatus: 'BEKLEMEDE',
        actorId: req.user.sub,
        note: 'Düzeltme onaya gönderildi.',
      });

      if (nc.openedById !== req.user.sub) {
        await createNotification(tx, {
          userId: nc.openedById,
          nonconformityId: nc.id,
          title: 'Düzeltme onay bekliyor',
          message: `${nc.number} numaralı uygunsuzluk için düzeltme gönderildi, onayınız bekleniyor.`,
        });
      }

      return correction;
    });

    await logAudit({
      userId: req.user.sub,
      action: 'NONCONFORMITY_CORRECTION_SUBMIT',
      entityType: 'nonconformity',
      entityId: nc.id,
      details: { correctionId: result.id },
      ipAddress: req.ip,
    });

    res.status(201).json({ correction: result });
  })
);

// ---------------------------------------------------------------------------
// Düzeltmeyi onaylama
// ---------------------------------------------------------------------------
router.post(
  '/:id/corrections/:correctionId/approve',
  requirePermission('uygunsuzluk_onaylama'),
  asyncHandler(async (req, res) => {
    const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
    if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();

    const [correction] = await db
      .select()
      .from(nonconformityCorrections)
      .where(and(eq(nonconformityCorrections.id, req.params.correctionId), eq(nonconformityCorrections.nonconformityId, nc.id)))
      .limit(1);
    if (!correction) throw ApiError.notFound('Düzeltme kaydı bulunamadı.');
    if (nc.status !== 'BEKLEMEDE' || correction.status !== 'BEKLEMEDE') {
      throw ApiError.conflict('Bu düzeltme onay/red için uygun durumda değil.');
    }

    await db.transaction(async (tx) => {
      await tx
        .update(nonconformityCorrections)
        .set({ status: 'ONAYLANDI', reviewedById: req.user.sub, reviewedAt: new Date() })
        .where(eq(nonconformityCorrections.id, correction.id));

      await tx
        .update(nonconformities)
        .set({ status: 'KAPALI', closedAt: new Date(), updatedAt: new Date() })
        .where(eq(nonconformities.id, nc.id));

      await logStatusChange(tx, {
        nonconformityId: nc.id,
        fromStatus: 'BEKLEMEDE',
        toStatus: 'KAPALI',
        actorId: req.user.sub,
        note: 'Düzeltme onaylandı, uygunsuzluk kapatıldı.',
      });

      const assigneesByNc = await loadAssigneesFor([nc.id], tx);
      await createNotifications(tx, {
        userIds: (assigneesByNc[nc.id] || []).map((a) => a.userId),
        nonconformityId: nc.id,
        title: 'Uygunsuzluk kapatıldı',
        message: `${nc.number} numaralı uygunsuzluk onaylanarak kapatıldı.`,
      });
    });

    await logAudit({
      userId: req.user.sub,
      action: 'NONCONFORMITY_CORRECTION_APPROVE',
      entityType: 'nonconformity',
      entityId: nc.id,
      details: { correctionId: correction.id },
      ipAddress: req.ip,
    });

    res.json({ success: true });
  })
);

// ---------------------------------------------------------------------------
// Düzeltmeyi reddetme
// ---------------------------------------------------------------------------
const rejectSchema = z.object({ reviewNote: z.string().min(3, 'Red gerekçesi zorunludur.') });

router.post(
  '/:id/corrections/:correctionId/reject',
  requirePermission('uygunsuzluk_onaylama'),
  asyncHandler(async (req, res) => {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Red gerekçesi zorunludur.', parsed.error.flatten());

    const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
    if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();

    const [correction] = await db
      .select()
      .from(nonconformityCorrections)
      .where(and(eq(nonconformityCorrections.id, req.params.correctionId), eq(nonconformityCorrections.nonconformityId, nc.id)))
      .limit(1);
    if (!correction) throw ApiError.notFound('Düzeltme kaydı bulunamadı.');
    if (nc.status !== 'BEKLEMEDE' || correction.status !== 'BEKLEMEDE') {
      throw ApiError.conflict('Bu düzeltme onay/red için uygun durumda değil.');
    }

    await db.transaction(async (tx) => {
      await tx
        .update(nonconformityCorrections)
        .set({
          status: 'REDDEDILDI',
          reviewedById: req.user.sub,
          reviewedAt: new Date(),
          reviewNote: parsed.data.reviewNote,
        })
        .where(eq(nonconformityCorrections.id, correction.id));

      await tx.update(nonconformities).set({ status: 'ACIK', updatedAt: new Date() }).where(eq(nonconformities.id, nc.id));

      await logStatusChange(tx, {
        nonconformityId: nc.id,
        fromStatus: 'BEKLEMEDE',
        toStatus: 'ACIK',
        actorId: req.user.sub,
        note: `Düzeltme reddedildi: ${parsed.data.reviewNote}`,
      });

      const assigneesByNc = await loadAssigneesFor([nc.id], tx);
      await createNotifications(tx, {
        userIds: (assigneesByNc[nc.id] || []).map((a) => a.userId),
        nonconformityId: nc.id,
        title: 'Düzeltme reddedildi',
        message: `${nc.number} numaralı uygunsuzluk için düzeltmeniz reddedildi: ${parsed.data.reviewNote}`,
      });
    });

    await logAudit({
      userId: req.user.sub,
      action: 'NONCONFORMITY_CORRECTION_REJECT',
      entityType: 'nonconformity',
      entityId: nc.id,
      details: { correctionId: correction.id, reviewNote: parsed.data.reviewNote },
      ipAddress: req.ip,
    });

    res.json({ success: true });
  })
);

// ---------------------------------------------------------------------------
// Cezai işlem talebi: termin süresi geçmiş ve hâlâ kapatılmamış bir uygunsuzluk için,
// açan kişi (veya admin) tarafından oluşturulur. Onaya admin ve 'cezai_islem' yetkisine
// sahip kişilere gönderilir. Bu yalnızca bir talep/kayıttır; sistem otomatik bir yaptırım
// uygulamaz.
// ---------------------------------------------------------------------------
const penaltyRequestSchema = z.object({
  reason: z.string().min(5, 'Gerekçe en az 5 karakter olmalıdır.'),
  sanctionType: z.enum(['PARA_CEZASI', 'UYARI', 'CALISMADAN_UZAKLASTIRMA', 'IS_AKDI_FESHI', 'DIGER']).default('PARA_CEZASI'),
  suggestedAmount: z.number().int().positive().optional().nullable(),
});

router.post(
  '/:id/penalty-request',
  asyncHandler(async (req, res) => {
    const parsed = penaltyRequestSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz ceza talebi.', parsed.error.flatten());

    const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
    if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();

    if (!req.user.isSystemAdmin && nc.openedById !== req.user.sub) {
      throw ApiError.forbidden('Cezai işlem talebini yalnızca uygunsuzluğu açan kişi oluşturabilir.');
    }
    if (nc.status === 'KAPALI') {
      throw ApiError.conflict('Kapatılmış bir uygunsuzluk için ceza talebi oluşturulamaz.');
    }
    if (new Date(nc.dueDate).getTime() > Date.now()) {
      throw ApiError.conflict('Termin süresi henüz dolmadan ceza talebi oluşturulamaz.');
    }

    const [existingPending] = await db
      .select({ id: penalties.id })
      .from(penalties)
      .where(and(eq(penalties.nonconformityId, nc.id), eq(penalties.status, 'BEKLEMEDE')))
      .limit(1);
    if (existingPending) {
      throw ApiError.conflict('Bu uygunsuzluk için zaten onay bekleyen bir ceza talebi var.');
    }

    const [created] = await db
      .insert(penalties)
      .values({
        nonconformityId: nc.id,
        employeeId: nc.employeeId || null,
        requestedById: req.user.sub,
        reason: parsed.data.reason,
        sanctionType: parsed.data.sanctionType,
        suggestedAmount: parsed.data.suggestedAmount || null,
      })
      .returning();

    let employeePriorApprovedCount = 0;
    if (nc.employeeId) {
      const [row] = await db
        .select({ value: count() })
        .from(penalties)
        .where(and(eq(penalties.employeeId, nc.employeeId), eq(penalties.status, 'ONAYLANDI')));
      employeePriorApprovedCount = row?.value || 0;
    }

    // Bildirim: sistem adminleri + bu projede 'cezai_islem' yetkisi olan kullanıcılar.
    const adminUsers = await db.select({ id: users.id }).from(users).where(eq(users.isSystemAdmin, true));
    const permHolders = await db
      .select({ userId: userPermissions.userId })
      .from(userPermissions)
      .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
      .where(
        and(
          eq(permissions.key, 'cezai_islem'),
          eq(userPermissions.granted, true),
          or(isNull(userPermissions.projectId), eq(userPermissions.projectId, nc.projectId))
        )
      );
    const notifyIds = [...new Set([...adminUsers.map((u) => u.id), ...permHolders.map((p) => p.userId)])];
    await createNotifications(null, {
      userIds: notifyIds,
      nonconformityId: nc.id,
      title: 'Ceza talebi onay bekliyor',
      message: `${nc.number} numaralı uygunsuzluk termin süresini aştı, cezai işlem talebi onayınızı bekliyor.`,
    });

    await logAudit({
      userId: req.user.sub,
      action: 'PENALTY_REQUEST',
      entityType: 'penalty',
      entityId: created.id,
      details: { nonconformityId: nc.id, sanctionType: parsed.data.sanctionType },
      ipAddress: req.ip,
    });

    res.status(201).json({ penalty: created, employeePriorApprovedCount });
  })
);

// ---------------------------------------------------------------------------
// Ek termin süresi talebi: termin dolmuş/dolmak üzere olan bir uygunsuzluk için, atanan kişi
// ceza almamak amacıyla ek süre talep edebilir. Talep, açan kişiye (veya admine) onaya gider.
// Onaylanırsa uygunsuzluğun termin tarihi güncellenir; reddedilirse açan kişi dilerse ayrıca
// cezai işlem talebinde bulunabilir (mevcut ceza talebi ucu üzerinden, ayrıca bir işlem).
// ---------------------------------------------------------------------------
const extensionRequestSchema = z.object({
  requestedNewDueDate: z.string().datetime({ message: 'Geçerli bir tarih giriniz.' }),
  reason: z.string().min(5, 'Gerekçe en az 5 karakter olmalıdır.'),
});

router.post(
  '/:id/extension-request',
  asyncHandler(async (req, res) => {
    const parsed = extensionRequestSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz ek süre talebi.', parsed.error.flatten());

    const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
    if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();
    if (nc.status === 'KAPALI') throw ApiError.conflict('Kapatılmış bir uygunsuzluk için ek süre talep edilemez.');

    const assigneeIds = await loadAssigneeIdsFor(nc.id);
    if (!req.user.isSystemAdmin && !assigneeIds.includes(req.user.sub)) {
      throw ApiError.forbidden('Ek süre talebini yalnızca uygunsuzluğa atanan kişiler oluşturabilir.');
    }

    const requestedNewDueDate = new Date(parsed.data.requestedNewDueDate);
    if (requestedNewDueDate.getTime() <= new Date(nc.dueDate).getTime()) {
      throw ApiError.badRequest('Yeni termin tarihi, mevcut termin tarihinden ileri bir tarih olmalıdır.');
    }

    const [existingPending] = await db
      .select({ id: dueDateExtensions.id })
      .from(dueDateExtensions)
      .where(and(eq(dueDateExtensions.nonconformityId, nc.id), eq(dueDateExtensions.status, 'BEKLEMEDE')))
      .limit(1);
    if (existingPending) throw ApiError.conflict('Bu uygunsuzluk için zaten onay bekleyen bir ek süre talebi var.');

    const [created] = await db
      .insert(dueDateExtensions)
      .values({
        nonconformityId: nc.id,
        requestedById: req.user.sub,
        currentDueDate: nc.dueDate,
        requestedNewDueDate,
        reason: parsed.data.reason,
      })
      .returning();

    const adminUsers = await db.select({ id: users.id }).from(users).where(eq(users.isSystemAdmin, true));
    const notifyIds = [...new Set([nc.openedById, ...adminUsers.map((u) => u.id)])];
    await createNotifications(null, {
      userIds: notifyIds,
      nonconformityId: nc.id,
      title: 'Ek süre talebi onay bekliyor',
      message: `${nc.number} numaralı uygunsuzluk için ek termin süresi talep edildi, onayınızı bekliyor.`,
    });

    await logAudit({
      userId: req.user.sub,
      action: 'DUE_DATE_EXTENSION_REQUEST',
      entityType: 'due_date_extension',
      entityId: created.id,
      details: { nonconformityId: nc.id, requestedNewDueDate: parsed.data.requestedNewDueDate },
      ipAddress: req.ip,
    });

    res.status(201).json({ extension: created });
  })
);

async function loadExtensionWithNc(id) {
  const [row] = await db
    .select({ extension: dueDateExtensions, nonconformity: nonconformities })
    .from(dueDateExtensions)
    .innerJoin(nonconformities, eq(dueDateExtensions.nonconformityId, nonconformities.id))
    .where(eq(dueDateExtensions.id, id))
    .limit(1);
  return row;
}

router.post(
  '/:id/extension-request/:extId/approve',
  asyncHandler(async (req, res) => {
    const row = await loadExtensionWithNc(req.params.extId);
    if (!row || row.nonconformity.id !== req.params.id) throw ApiError.notFound('Ek süre talebi bulunamadı.');
    const { extension: ext, nonconformity: nc } = row;
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();
    if (!req.user.isSystemAdmin && nc.openedById !== req.user.sub) {
      throw ApiError.forbidden('Ek süre talebini yalnızca uygunsuzluğu açan kişi veya admin onaylayabilir.');
    }
    if (ext.status !== 'BEKLEMEDE') throw ApiError.conflict('Bu talep zaten karara bağlanmış.');

    const schema = z.object({ decisionNote: z.string().optional().nullable() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.');

    await db.transaction(async (tx) => {
      await tx
        .update(dueDateExtensions)
        .set({ status: 'ONAYLANDI', decidedById: req.user.sub, decidedAt: new Date(), decisionNote: parsed.data.decisionNote || null })
        .where(eq(dueDateExtensions.id, ext.id));

      // Termin tarihi güncellenir; zamanlayıcı bayrakları sıfırlanır ki yeni termine göre
      // 2/3 uyarısı ve dolum bildirimi tekrar doğru zamanda çalışsın.
      await tx
        .update(nonconformities)
        .set({ dueDate: ext.requestedNewDueDate, deadlineReminderSentAt: null, deadlineExpiredNotifiedAt: null, updatedAt: new Date() })
        .where(eq(nonconformities.id, nc.id));

      await logStatusChange(tx, {
        nonconformityId: nc.id,
        fromStatus: nc.status,
        toStatus: nc.status,
        actorId: req.user.sub,
        note: `Ek süre talebi onaylandı, yeni termin: ${new Date(ext.requestedNewDueDate).toLocaleString('tr-TR')}.`,
      });
    });

    const assigneeIds = await loadAssigneeIdsFor(nc.id);
    await createNotifications(null, {
      userIds: [...new Set([ext.requestedById, ...assigneeIds])],
      nonconformityId: nc.id,
      title: 'Ek süre talebiniz onaylandı',
      message: `${nc.number} numaralı uygunsuzluk için ek süre talebiniz onaylandı. Yeni termin: ${new Date(ext.requestedNewDueDate).toLocaleString('tr-TR')}.`,
    });

    await logAudit({ userId: req.user.sub, action: 'DUE_DATE_EXTENSION_APPROVE', entityType: 'due_date_extension', entityId: ext.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

router.post(
  '/:id/extension-request/:extId/reject',
  asyncHandler(async (req, res) => {
    const row = await loadExtensionWithNc(req.params.extId);
    if (!row || row.nonconformity.id !== req.params.id) throw ApiError.notFound('Ek süre talebi bulunamadı.');
    const { extension: ext, nonconformity: nc } = row;
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();
    if (!req.user.isSystemAdmin && nc.openedById !== req.user.sub) {
      throw ApiError.forbidden('Ek süre talebini yalnızca uygunsuzluğu açan kişi veya admin reddedebilir.');
    }
    if (ext.status !== 'BEKLEMEDE') throw ApiError.conflict('Bu talep zaten karara bağlanmış.');

    const schema = z.object({ decisionNote: z.string().min(3, 'Red gerekçesi zorunludur.') });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Red gerekçesi zorunludur.', parsed.error.flatten());

    await db
      .update(dueDateExtensions)
      .set({ status: 'REDDEDILDI', decidedById: req.user.sub, decidedAt: new Date(), decisionNote: parsed.data.decisionNote })
      .where(eq(dueDateExtensions.id, ext.id));

    await createNotification(null, {
      userId: ext.requestedById,
      nonconformityId: nc.id,
      title: 'Ek süre talebiniz reddedildi',
      message: `${nc.number} numaralı uygunsuzluk için ek süre talebiniz reddedildi: ${parsed.data.decisionNote}. Uygunsuzluğu kapatmadığınız sürece cezai işlem başlatılabilir.`,
    });

    await logAudit({ userId: req.user.sub, action: 'DUE_DATE_EXTENSION_REJECT', entityType: 'due_date_extension', entityId: ext.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

// Admin, bekleyen bir talep olmadan da doğrudan termin süresi uzatabilir (ör. saha koşulları
// nedeniyle proaktif karar). Bu işlem de kayıt altına alınır (ONAYLANDI durumunda bir
// due_date_extensions satırı olarak), böylece geçmişte tutarlı bir tarihçe kalır.
const adminExtendSchema = z.object({
  newDueDate: z.string().datetime({ message: 'Geçerli bir tarih giriniz.' }),
  note: z.string().optional().nullable(),
});

router.post(
  '/:id/extend-due-date',
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const parsed = adminExtendSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());

    const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
    if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');
    if (nc.status === 'KAPALI') throw ApiError.conflict('Kapatılmış bir uygunsuzluğun termini değiştirilemez.');

    const newDueDate = new Date(parsed.data.newDueDate);

    await db.transaction(async (tx) => {
      await tx.insert(dueDateExtensions).values({
        nonconformityId: nc.id,
        requestedById: req.user.sub,
        currentDueDate: nc.dueDate,
        requestedNewDueDate: newDueDate,
        reason: 'Admin tarafından doğrudan verildi.',
        status: 'ONAYLANDI',
        decidedById: req.user.sub,
        decidedAt: new Date(),
        decisionNote: parsed.data.note || null,
      });

      await tx
        .update(nonconformities)
        .set({ dueDate: newDueDate, deadlineReminderSentAt: null, deadlineExpiredNotifiedAt: null, updatedAt: new Date() })
        .where(eq(nonconformities.id, nc.id));

      await logStatusChange(tx, {
        nonconformityId: nc.id,
        fromStatus: nc.status,
        toStatus: nc.status,
        actorId: req.user.sub,
        note: `Admin tarafından termin tarihi güncellendi: ${newDueDate.toLocaleString('tr-TR')}.`,
      });
    });

    const assigneeIds = await loadAssigneeIdsFor(nc.id);
    await createNotifications(null, {
      userIds: [...new Set([nc.openedById, ...assigneeIds])],
      nonconformityId: nc.id,
      title: 'Termin tarihi güncellendi',
      message: `${nc.number} numaralı uygunsuzluğun termin tarihi admin tarafından güncellendi: ${newDueDate.toLocaleString('tr-TR')}.${parsed.data.note ? ` Not: ${parsed.data.note}` : ''}`,
    });

    await logAudit({ userId: req.user.sub, action: 'DUE_DATE_EXTEND_ADMIN', entityType: 'nonconformity', entityId: nc.id, details: { newDueDate: parsed.data.newDueDate }, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
