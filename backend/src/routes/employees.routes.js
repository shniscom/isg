const express = require('express');
const { z } = require('zod');
const { eq, and, or, count, ilike, inArray, desc, asc, isNull, isNotNull, ne, sql } = require('drizzle-orm');
const { db } = require('../db/client');
const { employees, nonconformities, companies, userProjects, incidents } = require('../db/schema');
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
    } else if ((hasPermission(req, 'uygunsuzluk_acma') || hasPermission(req, 'kaza_bildirimi')) && requestedCompanyId) {
      // Uygunsuzluk açma ya da kaza/ramak kala bildirimi yetkisi olan kişi, açma formunda
      // seçtiği tek bir firmanın çalışan listesini görebilir (mükerrer kayıt oluşturmamak
      // ve kazayı geçiren/görgü tanığı seçebilmek için); genel gözatma yetkisi vermez.
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

const EMPLOYEE_LIST_COLUMNS = {
  id: employees.id,
  fullName: employees.fullName,
  nationalId: employees.nationalId,
  companyId: employees.companyId,
  companyName: companies.name,
  position: employees.position,
  isgTrainingDate: employees.isgTrainingDate,
  isgTrainingExpiryDate: employees.isgTrainingExpiryDate,
  medicalExamDate: employees.medicalExamDate,
  startWorkTrainingNote: employees.startWorkTrainingNote,
  ek2Note: employees.ek2Note,
  healthAuthoritySignatureNote: employees.healthAuthoritySignatureNote,
  isgRole: employees.isgRole,
  mykCertificateNo: employees.mykCertificateNo,
  mykCertificateDate: employees.mykCertificateDate,
  startDate: employees.startDate,
  endDate: employees.endDate,
  isActive: employees.isActive,
  createdAt: employees.createdAt,
};

// ---------------------------------------------------------------------------
// Çalışanlar sekmesindeki filtre sekmeleri (tümü/myk/eğitimsiz/tetkik/İSG görevi) için sayılar.
// GET / listesiyle aynı kapsam (proje/firma/durum/arama) mantığını kullanır, sadece "filter"
// parametresini uygulamadan her bir filtrenin kaç kayıt döndüreceğini tek sorguda hesaplar.
// ---------------------------------------------------------------------------
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);
    const companyFilterIds = await resolveCompanyScope(req, projectId, req.query.companyId || null);

    const conditions = [eq(employees.projectId, projectId)];
    if (companyFilterIds) {
      if (companyFilterIds.length === 0) {
        return res.json({ total: 0, myk: 0, untrained: 0, medicalExam: 0, isgRole: 0 });
      }
      conditions.push(or(...companyFilterIds.map((id) => eq(employees.companyId, id))));
    }

    const status = req.query.status === 'archived' ? 'archived' : req.query.status === 'all' ? 'all' : 'active';
    if (status === 'active') conditions.push(eq(employees.isActive, true));
    else if (status === 'archived') conditions.push(eq(employees.isActive, false));

    const searchTerm = req.query.q || req.query.search;
    if (searchTerm) {
      conditions.push(or(ilike(employees.fullName, `%${searchTerm}%`), ilike(employees.nationalId, `%${searchTerm}%`)));
    }

    const [row] = await db
      .select({
        total: count(),
        myk: sql`count(*) filter (where ${employees.mykCertificateNo} is not null and ${employees.mykCertificateNo} <> '')`.mapWith(Number),
        untrained: sql`count(*) filter (where ${employees.isgTrainingDate} is null)`.mapWith(Number),
        medicalExam: sql`count(*) filter (where ${employees.medicalExamDate} is not null)`.mapWith(Number),
        isgRole: sql`count(*) filter (where ${employees.isgRole} is not null and ${employees.isgRole} <> '')`.mapWith(Number),
      })
      .from(employees)
      .leftJoin(companies, eq(employees.companyId, companies.id))
      .where(and(...conditions));

    res.json(row);
  })
);

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

    // Filtre sekmeleri: tümü (varsayılan) | myk | untrained (eğitimsiz) | medicalExam (tetkik) | isgRole (İSG görevi)
    const filter = req.query.filter;
    if (filter === 'myk') {
      conditions.push(and(isNotNull(employees.mykCertificateNo), ne(employees.mykCertificateNo, '')));
    } else if (filter === 'untrained') {
      conditions.push(isNull(employees.isgTrainingDate));
    } else if (filter === 'medicalExam') {
      conditions.push(isNotNull(employees.medicalExamDate));
    } else if (filter === 'isgRole') {
      conditions.push(and(isNotNull(employees.isgRole), ne(employees.isgRole, '')));
    }

    const sortColumn = SORTABLE_COLUMNS[req.query.sortBy] || employees.fullName;
    const sortDir = req.query.sortDir === 'desc' ? desc : req.query.sortDir === 'asc' ? asc : req.query.sortBy === 'startDate' ? desc : asc;

    // Sayfalama opsiyoneldir: page parametresi verilmezse (ör. uygunsuzluk açma formundaki
    // aranabilir seçici için) tüm liste döner, uzun listelerin sayfa-sayfa gezilebildiği
    // Çalışanlar sekmesi ise page/pageSize gönderir.
    const pageParam = req.query.page ? parseInt(req.query.page, 10) : null;
    const usePagination = Number.isInteger(pageParam) && pageParam > 0;
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 30, 1), 200);
    const page = usePagination ? pageParam : 1;

    let query = db
      .select(EMPLOYEE_LIST_COLUMNS)
      .from(employees)
      .leftJoin(companies, eq(employees.companyId, companies.id))
      .where(and(...conditions))
      .orderBy(sortDir(sortColumn));
    if (usePagination) {
      query = query.limit(pageSize).offset((page - 1) * pageSize);
    }
    const rows = await query;

    const warningCounts = await db
      .select({ employeeId: nonconformities.employeeId, value: count() })
      .from(nonconformities)
      .where(eq(nonconformities.projectId, projectId))
      .groupBy(nonconformities.employeeId);
    const warningByEmployee = new Map(warningCounts.filter((r) => r.employeeId).map((r) => [r.employeeId, r.value]));

    const incidentCounts = await db
      .select({ employeeId: incidents.employeeId, value: count() })
      .from(incidents)
      .where(inArray(incidents.employeeId, rows.map((r) => r.id)))
      .groupBy(incidents.employeeId);
    const incidentByEmployee = new Map(incidentCounts.filter((r) => r.employeeId).map((r) => [r.employeeId, r.value]));

    const rowsWithCounts = rows.map((r) => ({
      ...r,
      warningCount: warningByEmployee.get(r.id) || 0,
      incidentCount: incidentByEmployee.get(r.id) || 0,
    }));

    if (!usePagination) {
      res.json({ employees: rowsWithCounts });
      return;
    }

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(employees)
      .leftJoin(companies, eq(employees.companyId, companies.id))
      .where(and(...conditions));

    res.json({
      employees: rowsWithCounts,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  })
);

// ---------------------------------------------------------------------------
// Yeni çalışan kaydı (uygunsuzluk açma akışında "isim bilinen ama kayıtlı olmayan" bir
// çalışanı hızlıca eklemek için, ya da Çalışanlar sekmesinden tekil ekleme). uygunsuzluk_acma
// yetkisi yeterlidir. TC no/görev/giriş tarihi burada teknik olarak opsiyoneldir (uygunsuzluk
// açma formundaki hızlı ekleme akışı sahada asgari bilgiyle çalışabilmelidir); Çalışanlar
// sekmesindeki tam ekleme formu bu alanları arayüzde zorunlu kılar.
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
  isgTrainingDate: z.string().optional().nullable().or(z.literal('')),
  isgTrainingExpiryDate: z.string().optional().nullable().or(z.literal('')),
  medicalExamDate: z.string().optional().nullable().or(z.literal('')),
  startWorkTrainingNote: z.string().optional().nullable().or(z.literal('')),
  ek2Note: z.string().optional().nullable().or(z.literal('')),
  healthAuthoritySignatureNote: z.string().optional().nullable().or(z.literal('')),
  isgRole: z.string().optional().nullable().or(z.literal('')),
  mykCertificateNo: z.string().optional().nullable().or(z.literal('')),
  mykCertificateDate: z.string().optional().nullable().or(z.literal('')),
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
        isgTrainingDate: toDateOrNull(parsed.data.isgTrainingDate),
        isgTrainingExpiryDate: toDateOrNull(parsed.data.isgTrainingExpiryDate),
        medicalExamDate: toDateOrNull(parsed.data.medicalExamDate),
        startWorkTrainingNote: parsed.data.startWorkTrainingNote || null,
        ek2Note: parsed.data.ek2Note || null,
        healthAuthoritySignatureNote: parsed.data.healthAuthoritySignatureNote || null,
        isgRole: parsed.data.isgRole || null,
        mykCertificateNo: parsed.data.mykCertificateNo || null,
        mykCertificateDate: toDateOrNull(parsed.data.mykCertificateDate),
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
  isgTrainingDate: z.string().optional().nullable().or(z.literal('')),
  isgTrainingExpiryDate: z.string().optional().nullable().or(z.literal('')),
  medicalExamDate: z.string().optional().nullable().or(z.literal('')),
  startWorkTrainingNote: z.string().optional().nullable().or(z.literal('')),
  ek2Note: z.string().optional().nullable().or(z.literal('')),
  healthAuthoritySignatureNote: z.string().optional().nullable().or(z.literal('')),
  isgRole: z.string().optional().nullable().or(z.literal('')),
  mykCertificateNo: z.string().optional().nullable().or(z.literal('')),
  mykCertificateDate: z.string().optional().nullable().or(z.literal('')),
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
    if (parsed.data.isgTrainingDate !== undefined) values.isgTrainingDate = toDateOrNull(parsed.data.isgTrainingDate);
    if (parsed.data.isgTrainingExpiryDate !== undefined) values.isgTrainingExpiryDate = toDateOrNull(parsed.data.isgTrainingExpiryDate);
    if (parsed.data.medicalExamDate !== undefined) values.medicalExamDate = toDateOrNull(parsed.data.medicalExamDate);
    if (parsed.data.startWorkTrainingNote !== undefined) values.startWorkTrainingNote = parsed.data.startWorkTrainingNote || null;
    if (parsed.data.ek2Note !== undefined) values.ek2Note = parsed.data.ek2Note || null;
    if (parsed.data.healthAuthoritySignatureNote !== undefined) values.healthAuthoritySignatureNote = parsed.data.healthAuthoritySignatureNote || null;
    if (parsed.data.isgRole !== undefined) values.isgRole = parsed.data.isgRole || null;
    if (parsed.data.mykCertificateNo !== undefined) values.mykCertificateNo = parsed.data.mykCertificateNo || null;
    if (parsed.data.mykCertificateDate !== undefined) values.mykCertificateDate = toDateOrNull(parsed.data.mykCertificateDate);
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
// Tekil / toplu silme (sistem admini). Uygunsuzluk/ceza kayıtlarındaki employeeId
// referansları FK tanımı gereği (onDelete: 'set null') otomatik olarak boşa düşer;
// geçmiş uygunsuzluk kaydı silinmez, yalnızca çalışan bağlantısı kaldırılır.
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const [employee] = await db.select().from(employees).where(eq(employees.id, req.params.id)).limit(1);
    if (!employee) throw ApiError.notFound('Çalışan bulunamadı.');

    await db.delete(employees).where(eq(employees.id, employee.id));

    await logAudit({
      userId: req.user.sub,
      action: 'EMPLOYEE_DELETE',
      entityType: 'employee',
      entityId: employee.id,
      details: { fullName: employee.fullName },
      ipAddress: req.ip,
    });

    res.json({ deleted: true });
  })
);

const bulkDeleteSchema = z.object({
  projectId: z.string().optional(),
  ids: z.array(z.string()).min(1).max(1000),
});

router.post(
  '/bulk-delete',
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const parsed = bulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());
    const projectId = resolveProjectId(req, parsed.data.projectId);

    const deletedRows = await db
      .delete(employees)
      .where(and(inArray(employees.id, parsed.data.ids), eq(employees.projectId, projectId)))
      .returning({ id: employees.id });

    await logAudit({
      userId: req.user.sub,
      action: 'EMPLOYEE_BULK_DELETE',
      entityType: 'employee',
      entityId: projectId,
      details: { requestedCount: parsed.data.ids.length, deletedCount: deletedRows.length },
      ipAddress: req.ip,
    });

    res.json({ deletedCount: deletedRows.length });
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
// JSON olarak gönderilir. Gerçek şirket şablonuna göre TC no, işe giriş tarihi, ad soyad ve
// görev (SGK iş kolu) zorunludur; bunlardan biri eksikse satır atlanır. TC no ile eşleştirilerek
// mevcut kayıt güncellenir (yoksa ad soyad ile), yoksa yeni kayıt oluşturulur. Yeni listede yer
// almayan, hâlâ aktif olan eski kayıtlar tarihsiz (endDate boş) olarak arşivlenir - "işten
// çıkmış ama tarihi bilinmiyor" anlamına gelir.
// ---------------------------------------------------------------------------
const importRowSchema = z.object({
  fullName: z.string().optional().nullable(),
  nationalId: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  isgTrainingDate: z.string().optional().nullable(),
  isgTrainingExpiryDate: z.string().optional().nullable(),
  medicalExamDate: z.string().optional().nullable(),
  startWorkTrainingNote: z.string().optional().nullable(),
  ek2Note: z.string().optional().nullable(),
  healthAuthoritySignatureNote: z.string().optional().nullable(),
  isgRole: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
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
      // Tek bir satırdaki beklenmeyen bir hata (bozuk hücre, geçersiz değer vb.) tüm isteği
      // 500 ile düşürmemeli - o satır atlanıp devam edilir; aksi halde önceki satırlar zaten
      // veritabanına yazılmış olsa bile kullanıcıya genel bir sunucu hatası dönerdi.
      try {
        const row = parsed.data.rows[i];
        const fullName = (row.fullName || '').trim();
        const nationalId = (row.nationalId || '').trim();
        const position = (row.position || '').trim();
        const startDate = (row.startDate || '').trim();
        if (!fullName || !nationalId || !position || !startDate) {
          skipped += 1;
          errors.push(`Satır ${i + 2}: TC no, ad soyad, görev ve giriş tarihi zorunludur, atlandı.`);
          continue;
        }
        const matchKey = nationalId || fullName.toLowerCase();
        const existingRow = byNationalId.get(nationalId) || byName.get(fullName.toLowerCase());

        const values = {
          fullName,
          nationalId,
          position,
          isgTrainingDate: toDateOrNull(row.isgTrainingDate),
          isgTrainingExpiryDate: toDateOrNull(row.isgTrainingExpiryDate),
          medicalExamDate: toDateOrNull(row.medicalExamDate),
          startWorkTrainingNote: (row.startWorkTrainingNote || '').trim() || null,
          ek2Note: (row.ek2Note || '').trim() || null,
          healthAuthoritySignatureNote: (row.healthAuthoritySignatureNote || '').trim() || null,
          isgRole: (row.isgRole || '').trim() || null,
          startDate: toDateOrNull(startDate),
        };

        if (existingRow) {
          await db.update(employees).set(values).where(eq(employees.id, existingRow.id));
          updated += 1;
          const merged = { ...existingRow, ...values };
          byNationalId.set(nationalId, merged);
          byName.set(fullName.toLowerCase(), merged);
        } else {
          const [createdRow] = await db
            .insert(employees)
            .values({ projectId, companyId, isActive: true, ...values })
            .returning();
          created += 1;
          byNationalId.set(nationalId, createdRow);
          byName.set(fullName.toLowerCase(), createdRow);
        }
        seenKeys.add(matchKey);
      } catch (err) {
        skipped += 1;
        errors.push(`Satır ${i + 2}: işlenirken hata oluştu (${err.message}), atlandı.`);
      }
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
