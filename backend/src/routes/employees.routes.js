const express = require('express');
const { z } = require('zod');
const { eq, and, or, count, ilike, desc, asc } = require('drizzle-orm');
const { db } = require('../db/client');
const { employees, nonconformities, companies, userProjects } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { requireSystemAdmin } = require('../middleware/permission');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/apiError');
const { logAudit } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

/** İstekte bulunan kullanıcının çalışacağı proje id'sini belirler (nonconformities.routes.js ile aynı mantık). */
function resolveProjectId(req, explicitProjectId) {
  if (req.user.isSystemAdmin) {
    if (!explicitProjectId) throw ApiError.badRequest('Sistem admini için projectId parametresi zorunludur.');
    return explicitProjectId;
  }
  if (!req.user.projectId) throw ApiError.forbidden('Aktif bir proje bağlamınız yok. Lütfen tekrar giriş yapıp proje/görev seçin.');
  return req.user.projectId;
}

/** 'YYYY-MM-DD' veya ISO string bir tarihi Date nesnesine çevirir; boş/geçersizse null döner. */
function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function hasPermission(req, key) {
  return req.user.isSystemAdmin || (req.user.permissions || []).includes(key);
}

/**
 * Kullanıcının bu projede hangi firma(lar)a özel atandığını döner (userProjects.companyId dolu
 * olan satırlar). Boş dizi = firma bazlı bir kısıtlaması yok demektir.
 */
async function getScopedCompanyIds(userId, projectId) {
  const rows = await db
    .select({ companyId: userProjects.companyId })
    .from(userProjects)
    .where(and(eq(userProjects.userId, userId), eq(userProjects.projectId, projectId), eq(userProjects.isActive, true)));
  return rows.map((r) => r.companyId).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Listeleme: admin ve "uygunsuzluk_gorme" yetkisi olanlar projedeki tüm çalışanları görür;
// belirli bir firmaya atanmış kullanıcılar (firma yetkilisi) yalnızca o firmanın çalışanlarını görür.
// ---------------------------------------------------------------------------
/**
 * Kullanıcının bu projede çalışan listesini görüntüleme kapsamını (hangi firmalara
 * kısıtlı olduğunu) çözer. Firma bazlı kısıtlaması yoksa null döner (hepsini görür).
 */
async function resolveCompanyScope(req, projectId, requestedCompanyId) {
  let companyFilterIds = null;
  if (!req.user.isSystemAdmin && !hasPermission(req, 'uygunsuzluk_gorme')) {
    const scoped = await getScopedCompanyIds(req.user.sub, projectId);
    if (scoped.length > 0) {
      companyFilterIds = scoped;
    } else if (hasPermission(req, 'uygunsuzluk_acma') && requestedCompanyId) {
      // Uygunsuzluk açma yetkisi olan kişi, açma formunda seçtiği tek bir firmanın çalışan
      // listesini görebilir (mükerrer kayıt oluşturmamak için); genel gözatma yetkisi vermez.
      companyFilterIds = [requestedCompanyId];
    } else {
      throw ApiError.forbidden('Çalışan listesini görüntüleme yetkiniz yok.');
    }
  }
  if (requestedCompanyId) {
    companyFilterIds = companyFilterIds ? companyFilterIds.filter((id) => id === requestedCompanyId) : [requestedCompanyId];
  }
  return companyFilterIds;
}

// ---------------------------------------------------------------------------
// Firma bazlı çalışanlar sekmesi: önce projedeki firmalar (ve aktif çalışan sayıları)
// listelenir, kullanıcı bir firma seçince o firmanın çalışanları GET / ile getirilir.
// ---------------------------------------------------------------------------
router.get(
  '/companies',
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);
    const companyFilterIds = await resolveCompanyScope(req, projectId, null);

    const conditions = [eq(companies.projectId, projectId)];
    if (companyFilterIds) {
      if (companyFilterIds.length === 0) return res.json({ companies: [] });
      conditions.push(or(...companyFilterIds.map((id) => eq(companies.id, id))));
    }

    const companyRows = await db.select().from(companies).where(and(...conditions)).orderBy(companies.name);

    const [activeCounts, archivedCounts] = await Promise.all([
      db
        .select({ companyId: employees.companyId, value: count() })
        .from(employees)
        .where(and(eq(employees.projectId, projectId), eq(employees.isActive, true)))
        .groupBy(employees.companyId),
      db
        .select({ companyId: employees.companyId, value: count() })
        .from(employees)
        .where(and(eq(employees.projectId, projectId), eq(employees.isActive, false)))
        .groupBy(employees.companyId),
    ]);
    const activeMap = new Map(activeCounts.filter((r) => r.companyId).map((r) => [r.companyId, r.value]));
    const archivedMap = new Map(archivedCounts.filter((r) => r.companyId).map((r) => [r.companyId, r.value]));

    res.json({
      companies: companyRows.map((c) => ({
        ...c,
        activeEmployeeCount: activeMap.get(c.id) || 0,
        archivedEmployeeCount: archivedMap.get(c.id) || 0,
      })),
    });
  })
);

const SORTABLE_COLUMNS = {
  fullName: employees.fullName,
  startDate: employees.startDate,
  createdAt: employees.createdAt,
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);
    const companyFilterIds = await resolveCompanyScope(req, projectId, req.query.companyId || null);

    const conditions = [eq(employees.projectId, projectId)];
    if (companyFilterIds) {
      if (companyFilterIds.length === 0) return res.json({ employees: [] });
      conditions.push(or(...companyFilterIds.map((id) => eq(employees.companyId, id))));
    }

    // status: 'active' (varsayılan) | 'archived' | 'all'
    const status = req.query.status === 'archived' ? 'archived' : req.query.status === 'all' ? 'all' : 'active';
    if (status === 'active') conditions.push(eq(employees.isActive, true));
    else if (status === 'archived') conditions.push(eq(employees.isActive, false));

    // Arama: ad soyad veya TC kimlik numarasına göre (soyad da fullName içinde arandığı için kapsanır).
    const searchTerm = req.query.q || req.query.search;
    if (searchTerm) {
      conditions.push(or(ilike(employees.fullName, `%${searchTerm}%`), ilike(employees.nationalId, `%${searchTerm}%`)));
    }

    const sortColumn = SORTABLE_COLUMNS[req.query.sortBy] || employees.fullName;
    const sortDir = req.query.sortDir === 'desc' ? desc : req.query.sortDir === 'asc' ? asc : req.query.sortBy === 'startDate' ? desc : asc;

    const rows = await db
      .select({
        id: employees.id,
        fullName: employees.fullName,
        nationalId: employees.nationalId,
        companyId: employees.companyId,
        companyName: companies.name,
        position: employees.position,
        isgTrainingCompleted: employees.isgTrainingCompleted,
        medicalExamNote: employees.medicalExamNote,
        startDate: employees.startDate,
        endDate: employees.endDate,
        isActive: employees.isActive,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .leftJoin(companies, eq(employees.companyId, companies.id))
      .where(and(...conditions))
      .orderBy(sortDir(sortColumn));

    const warningCounts = await db
      .select({ employeeId: nonconformities.employeeId, value: count() })
      .from(nonconformities)
      .where(eq(nonconformities.projectId, projectId))
      .groupBy(nonconformities.employeeId);
    const warningByEmployee = new Map(warningCounts.filter((r) => r.employeeId).map((r) => [r.employeeId, r.value]));

    const rowsWithCounts = rows.map((r) => ({ ...r, warningCount: warningByEmployee.get(r.id) || 0 }));
    res.json({ employees: rowsWithCounts });
  })
);

// ---------------------------------------------------------------------------
// Yeni çalışan kaydı (uygunsuzluk açma akışında "isim bilinen ama kayıtlı olmayan" bir
// çalışanı hızlıca eklemek için). uygunsuzluk_acma yetkisi yeterlidir.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  projectId: z.string().optional(),
  companyId: z.string().optional().nullable(),
  fullName: z.string().min(2, 'Ad soyad en az 2 karakter olmalıdır.'),
  nationalId: z
    .string()
    .regex(/^\d{11}$/, 'T.C. kimlik numarası 11 haneli olmalıdır.')
    .optional()
    .nullable()
    .or(z.literal('')),
  position: z.string().optional().nullable().or(z.literal('')),
  isgTrainingCompleted: z.boolean().optional(),
  medicalExamNote: z.string().optional().nullable().or(z.literal('')),
  startDate: z.string().optional().nullable().or(z.literal('')),
  endDate: z.string().optional().nullable().or(z.literal('')),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!hasPermission(req, 'uygunsuzluk_acma')) throw ApiError.forbidden();
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz çalışan bilgisi.', parsed.error.flatten());
    const projectId = resolveProjectId(req, parsed.data.projectId);
    const endDate = parsed.data.endDate || null;

    const [created] = await db
      .insert(employees)
      .values({
        projectId,
        companyId: parsed.data.companyId || null,
        fullName: parsed.data.fullName,
        nationalId: parsed.data.nationalId || null,
        position: parsed.data.position || null,
        isgTrainingCompleted: !!parsed.data.isgTrainingCompleted,
        medicalExamNote: parsed.data.medicalExamNote || null,
        startDate: toDateOrNull(parsed.data.startDate),
        endDate: toDateOrNull(endDate),
        isActive: !endDate,
      })
      .returning();

    await logAudit({
      userId: req.user.sub,
      action: 'EMPLOYEE_CREATE',
      entityType: 'employee',
      entityId: created.id,
      details: { fullName: created.fullName },
      ipAddress: req.ip,
    });

    res.status(201).json({ employee: created });
  })
);

// ---------------------------------------------------------------------------
// Çalışan kaydını düzenleme / çıkış tarihi girme (arşivleme). Çıkış tarihi girildiğinde
// (veya boş bırakıldığında temizlenip yeniden aktif edildiğinde) isActive otomatik güncellenir.
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  companyId: z.string().optional().nullable(),
  fullName: z.string().min(2).optional(),
  nationalId: z.string().regex(/^\d{11}$/).optional().nullable().or(z.literal('')),
  position: z.string().optional().nullable().or(z.literal('')),
  isgTrainingCompleted: z.boolean().optional(),
  medicalExamNote: z.string().optional().nullable().or(z.literal('')),
  startDate: z.string().optional().nullable().or(z.literal('')),
  endDate: z.string().optional().nullable().or(z.literal('')),
});

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!hasPermission(req, 'uygunsuzluk_acma')) throw ApiError.forbidden();
    const [employee] = await db.select().from(employees).where(eq(employees.id, req.params.id)).limit(1);
    if (!employee) throw ApiError.notFound('Çalışan bulunamadı.');

    if (!req.user.isSystemAdmin && !hasPermission(req, 'uygunsuzluk_gorme')) {
      const scoped = await getScopedCompanyIds(req.user.sub, employee.projectId);
      if (!scoped.includes(employee.companyId)) throw ApiError.forbidden();
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz çalışan bilgisi.', parsed.error.flatten());

    const values = {};
    if (parsed.data.companyId !== undefined) values.companyId = parsed.data.companyId || null;
    if (parsed.data.fullName !== undefined) values.fullName = parsed.data.fullName;
    if (parsed.data.nationalId !== undefined) values.nationalId = parsed.data.nationalId || null;
    if (parsed.data.position !== undefined) values.position = parsed.data.position || null;
    if (parsed.data.isgTrainingCompleted !== undefined) values.isgTrainingCompleted = !!parsed.data.isgTrainingCompleted;
    if (parsed.data.medicalExamNote !== undefined) values.medicalExamNote = parsed.data.medicalExamNote || null;
    if (parsed.data.startDate !== undefined) values.startDate = toDateOrNull(parsed.data.startDate);
    if (parsed.data.endDate !== undefined) {
      const endDateRaw = parsed.data.endDate || null;
      // Çıkış tarihi girilirse çalışan otomatik arşive alınır; temizlenirse yeniden aktif olur.
      values.isActive = !endDateRaw;
      values.endDate = toDateOrNull(endDateRaw);
    }

    const [updated] = await db.update(employees).set(values).where(eq(employees.id, employee.id)).returning();

    await logAudit({
      userId: req.user.sub,
      action: values.endDate !== undefined && values.endDate ? 'EMPLOYEE_ARCHIVE' : 'EMPLOYEE_UPDATE',
      entityType: 'employee',
      entityId: employee.id,
      details: values,
      ipAddress: req.ip,
    });

    res.json({ employee: updated });
  })
);

// ---------------------------------------------------------------------------
// Bir çalışana ait tüm uygunsuzluk kayıtları (detay/geçmiş görünümü)
// ---------------------------------------------------------------------------
router.get(
  '/:id/nonconformities',
  asyncHandler(async (req, res) => {
    const [employee] = await db.select().from(employees).where(eq(employees.id, req.params.id)).limit(1);
    if (!employee) throw ApiError.notFound('Çalışan bulunamadı.');

    if (!req.user.isSystemAdmin && !hasPermission(req, 'uygunsuzluk_gorme')) {
      const scoped = await getScopedCompanyIds(req.user.sub, employee.projectId);
      if (!scoped.includes(employee.companyId)) throw ApiError.forbidden();
    }

    const rows = await db
      .select({
        id: nonconformities.id,
        number: nonconformities.number,
        description: nonconformities.description,
        status: nonconformities.status,
        priority: nonconformities.priority,
        createdAt: nonconformities.createdAt,
      })
      .from(nonconformities)
      .where(eq(nonconformities.employeeId, employee.id))
      .orderBy(nonconformities.createdAt);

    res.json({ employee, nonconformities: rows });
  })
);

// ---------------------------------------------------------------------------
// Excel içe aktarma: liste tarayıcıda (xlsx kütüphanesi ile) satırlara ayrıştırılıp buraya
// JSON olarak gönderilir. Ad soyad + giriş tarihi zorunludur, eksik satırlar atlanır.
// TC no (varsa) veya ad soyad ile eşleştirilerek mevcut kayıt güncellenir, yoksa yeni
// kayıt oluşturulur. Yeni listede yer almayan, hâlâ aktif olan eski kayıtlar tarihsiz
// (endDate boş) olarak arşivlenir - "işten çıkmış ama tarihi bilinmiyor" anlamına gelir.
// ---------------------------------------------------------------------------
const importRowSchema = z.object({
  fullName: z.string().optional().nullable(),
  nationalId: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  isgTrainingCompleted: z.boolean().optional(),
  medicalExamNote: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

const importSchema = z.object({
  projectId: z.string().optional(),
  companyId: z.string().min(1, 'Firma seçilmelidir.'),
  rows: z.array(importRowSchema).max(5000),
});

router.post(
  '/import',
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz içe aktarma verisi.', parsed.error.flatten());
    const projectId = resolveProjectId(req, parsed.data.projectId);
    const { companyId } = parsed.data;

    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company || company.projectId !== projectId) throw ApiError.badRequest('Seçilen firma bu projeye ait değil.');

    let created = 0;
    let updated = 0;
    let archived = 0;
    let skipped = 0;
    const errors = [];
    const seenKeys = new Set();

    const existing = await db
      .select()
      .from(employees)
      .where(and(eq(employees.projectId, projectId), eq(employees.companyId, companyId)));
    const byNationalId = new Map(existing.filter((e) => e.nationalId).map((e) => [e.nationalId, e]));
    const byName = new Map(existing.map((e) => [e.fullName.trim().toLowerCase(), e]));

    for (let i = 0; i < parsed.data.rows.length; i++) {
      const row = parsed.data.rows[i];
      const fullName = (row.fullName || '').trim();
      const startDate = (row.startDate || '').trim();
      if (!fullName || !startDate) {
        skipped += 1;
        errors.push(`Satır ${i + 2}: Ad soyad ve giriş tarihi zorunludur, atlandı.`);
        continue;
      }
      const nationalId = (row.nationalId || '').trim() || null;
      const endDate = (row.endDate || '').trim() || null;
      const matchKey = nationalId || fullName.toLowerCase();
      const existingRow = (nationalId && byNationalId.get(nationalId)) || byName.get(fullName.toLowerCase());

      const values = {
        fullName,
        nationalId,
        position: (row.position || '').trim() || null,
        isgTrainingCompleted: !!row.isgTrainingCompleted,
        medicalExamNote: (row.medicalExamNote || '').trim() || null,
        startDate: toDateOrNull(startDate),
        endDate: toDateOrNull(endDate),
        isActive: !endDate,
      };

      if (existingRow) {
        await db.update(employees).set(values).where(eq(employees.id, existingRow.id));
        updated += 1;
        const merged = { ...existingRow, ...values };
        if (nationalId) byNationalId.set(nationalId, merged);
        byName.set(fullName.toLowerCase(), merged);
      } else {
        const [createdRow] = await db.insert(employees).values({ projectId, companyId, ...values }).returning();
        created += 1;
        if (nationalId) byNationalId.set(nationalId, createdRow);
        byName.set(fullName.toLowerCase(), createdRow);
      }
      seenKeys.add(matchKey);
    }

    for (const emp of existing) {
      const key = emp.nationalId || emp.fullName.trim().toLowerCase();
      if (emp.isActive && !seenKeys.has(key)) {
        await db.update(employees).set({ isActive: false, endDate: null }).where(eq(employees.id, emp.id));
        archived += 1;
      }
    }

    await logAudit({
      userId: req.user.sub,
      action: 'EMPLOYEE_IMPORT',
      entityType: 'employee',
      entityId: companyId,
      details: { projectId, companyId, created, updated, archived, skipped },
      ipAddress: req.ip,
    });

    res.json({ created, updated, archived, skipped, errors });
  })
);

module.exports = router;
