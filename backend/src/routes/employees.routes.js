const express = require('express');
const { z } = require('zod');
const { eq, and, or, count, ilike, inArray, desc, asc, isNull, isNotNull, ne, lt, sql } = require('drizzle-orm');
const { db } = require('../db/client');
const { employees, nonconformities, companies, userProjects, incidents, companyRoleAssignments } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { requireSystemAdmin, requirePermission } = require('../middleware/permission');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/apiError');
const { logAudit } = require('../utils/audit');
const { runOrQueueForApproval } = require('../utils/approval');

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

/**
 * Verilen tarih bugüne eşit veya geçmişte mi? Çıkış/görev bitiş tarihi girilirken çalışanın
 * HEMEN arşivlenip arşivlenmeyeceğine karar vermek için kullanılır: geçmiş/bugünkü bir tarih
 * "zaten gerçekleşmiş bir çıkış" sayılır ve anında arşivler, ama GELECEK bir tarih (örn. geçici
 * görevlendirmede henüz bitmemiş bir "görev bitiş tarihi") çalışanı aktif bırakmalı - o tarih
 * gelene kadar hâlâ sahada/görevde demektir. Gelecek tarihli çıkışların otomatik arşivlenmesi,
 * services/scheduledJobs.service.js içindeki günlük kontrolle yapılır (bkz. o dosya).
 */
/**
 * Bir çalışana bağlanmak istenen İSG uzmanı/işyeri hekimi/DSP atama kaydının (companyRoleAssignments
 * satırının) gerçekten o çalışanın firmasına ait ve doğru rol tipinde olduğunu doğrular - aksi
 * halde bir kullanıcı başka bir firmanın uzmanını (veya alakasız bir rolü, ör. Şantiye Şefi'ni)
 * yanlışlıkla/kasıtlı olarak "eğitimi veren uzman" olarak bağlayabilir. assignmentId boş/null ise
 * doğrulama atlanır (seçim temizleniyor demektir).
 */
async function assertAssignmentBelongsToCompany(assignmentId, companyId, roleType, label) {
  if (!assignmentId) return;
  if (!companyId) throw ApiError.badRequest(`${label} seçebilmek için önce çalışanın firması seçilmelidir.`);
  const [row] = await db.select().from(companyRoleAssignments).where(eq(companyRoleAssignments.id, assignmentId)).limit(1);
  if (!row || row.companyId !== companyId) {
    throw ApiError.badRequest(`Seçilen ${label.toLowerCase()} bu çalışanın firmasına ait değil.`);
  }
  if (row.roleType !== roleType) {
    throw ApiError.badRequest(`Seçilen kayıt "${label}" rolünde değil.`);
  }
}

function isPastOrToday(value) {
  if (!value) return false;
  const d = new Date(value);
  if (isNaN(d.getTime())) return false;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return d <= endOfToday;
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
  // İnsan Kaynakları Yönetimi yetkisi olanlar, uygunsuzluk_gorme yetkisi olanlarla aynı şekilde
  // projedeki TÜM firmaların çalışan listesini görebilmeli (işleri zaten bu - bkz. Kullanım Kılavuzu).
  if (!req.user.isSystemAdmin && !hasPermission(req, 'uygunsuzluk_gorme') && !hasPermission(req, 'insan_kaynaklari_yonetimi') && !hasPermission(req, 'gecici_gorevlendirme_yonetimi')) {
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

    // Pasif (silinmiş/deaktif) firmalar bu operasyonel listede görünmemeli - yalnızca admin
    // yönetim ekranı (GET /admin/companies) pasif firmaları da gösterir.
    const conditions = [eq(companies.projectId, projectId), eq(companies.isActive, true)];
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

/**
 * Çalışanlar sekmesindeki "Filtrele" menüsündeki her bir çoklu seçmeli filtre için karşılık
 * gelen SQL koşulu. GET / ve GET /stats aynı anahtar kümesini paylaşır (bkz. FILTER_CONDITIONS
 * kullanımı) - birden fazla filtre birlikte seçilirse OR ile birleştirilir (ör. "MYK'sı VEYA
 * tetkiki olmayanlar").
 */
const FILTER_CONDITIONS = {
  noMyk: () => or(isNull(employees.mykCertificateNo), eq(employees.mykCertificateNo, '')),
  noMedicalExam: () => isNull(employees.medicalExamDate),
  noTraining: () => isNull(employees.isgTrainingDate),
  trainingExpired: () => and(isNotNull(employees.isgTrainingExpiryDate), lt(employees.isgTrainingExpiryDate, new Date())),
  hasIsgRole: () => and(isNotNull(employees.isgRole), ne(employees.isgRole, '')),
};

/** ?filters=noMyk,noTraining gibi virgülle ayrılmış bir query param'ı OR koşuluna çevirir. */
function buildFilterCondition(rawFilters) {
  if (!rawFilters) return null;
  const keys = String(rawFilters)
    .split(',')
    .map((k) => k.trim())
    .filter((k) => FILTER_CONDITIONS[k]);
  if (keys.length === 0) return null;
  return or(...keys.map((k) => FILTER_CONDITIONS[k]()));
}

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
  ek2Date: employees.ek2Date,
  startWorkTrainingNote: employees.startWorkTrainingNote,
  ek2Note: employees.ek2Note,
  healthAuthoritySignatureNote: employees.healthAuthoritySignatureNote,
  isgRole: employees.isgRole,
  mykCertificateNo: employees.mykCertificateNo,
  mykCertificateDate: employees.mykCertificateDate,
  startDate: employees.startDate,
  endDate: employees.endDate,
  firstStartDate: employees.firstStartDate,
  lastExitDate: employees.lastExitDate,
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
        return res.json({ total: 0, noMyk: 0, noMedicalExam: 0, noTraining: 0, trainingExpired: 0, hasIsgRole: 0 });
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
        noMyk: sql`count(*) filter (where ${employees.mykCertificateNo} is null or ${employees.mykCertificateNo} = '')`.mapWith(Number),
        noMedicalExam: sql`count(*) filter (where ${employees.medicalExamDate} is null)`.mapWith(Number),
        noTraining: sql`count(*) filter (where ${employees.isgTrainingDate} is null)`.mapWith(Number),
        trainingExpired: sql`count(*) filter (where ${employees.isgTrainingExpiryDate} is not null and ${employees.isgTrainingExpiryDate} < now())`.mapWith(Number),
        hasIsgRole: sql`count(*) filter (where ${employees.isgRole} is not null and ${employees.isgRole} <> '')`.mapWith(Number),
      })
      .from(employees)
      .leftJoin(companies, eq(employees.companyId, companies.id))
      .where(and(...conditions));

    res.json(row);
  })
);

// ---------------------------------------------------------------------------
// Çoklu firma çalışan tespiti: aynı projede, aynı TC kimlik numarasıyla birden fazla
// firmanın (aktif) çalışan listesinde görünen kişileri gruplar halinde döner. Böyle bir
// durum genelde veri girişi hatası ya da bir çalışanın firma değiştirdiği halde eski
// kaydının kapatılmadığı anlamına gelir; admin buradan çalışanı ilgili firma(lar)dan
// kaldırabilir (bkz. DELETE /employees/:id - zaten yalnızca admin çağırabilir).
// ---------------------------------------------------------------------------
router.get(
  '/duplicates',
  asyncHandler(async (req, res) => {
    if (!req.user.isSystemAdmin && !hasPermission(req, 'insan_kaynaklari_yonetimi')) throw ApiError.forbidden('Bu raporu görüntüleme yetkiniz yok.');
    const projectId = resolveProjectId(req, req.query.projectId);

    const dupNationalIds = await db
      .select({ nationalId: employees.nationalId })
      .from(employees)
      .where(and(eq(employees.projectId, projectId), eq(employees.isActive, true), isNotNull(employees.nationalId), ne(employees.nationalId, '')))
      .groupBy(employees.nationalId)
      .having(sql`count(distinct ${employees.companyId}) > 1`);

    if (dupNationalIds.length === 0) return res.json({ groups: [] });

    const nationalIds = dupNationalIds.map((r) => r.nationalId);
    const rows = await db
      .select({
        id: employees.id,
        fullName: employees.fullName,
        nationalId: employees.nationalId,
        companyId: employees.companyId,
        companyName: companies.name,
        position: employees.position,
        startDate: employees.startDate,
      })
      .from(employees)
      .leftJoin(companies, eq(employees.companyId, companies.id))
      .where(and(eq(employees.projectId, projectId), eq(employees.isActive, true), inArray(employees.nationalId, nationalIds)))
      .orderBy(asc(employees.nationalId), asc(companies.name));

    const groupMap = new Map();
    for (const r of rows) {
      if (!groupMap.has(r.nationalId)) groupMap.set(r.nationalId, []);
      groupMap.get(r.nationalId).push(r);
    }

    res.json({ groups: Array.from(groupMap.values()) });
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

    // Çoklu seçmeli filtreler (bkz. FILTER_CONDITIONS): ?filters=noMyk,noTraining gibi
    // virgülle ayrılmış anahtarlar OR ile birleştirilir.
    const filterCondition = buildFilterCondition(req.query.filters);
    if (filterCondition) conditions.push(filterCondition);

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
  // Geçici görevlendirme alanları - yalnızca hedef firma companies.isTemporaryAssignment=true
  // ise anlamlıdır, ama şema düzeyinde her zaman kabul edilir (bkz. schema.js employees tablosu).
  assignmentFormExists: z.boolean().optional(),
  sgkEntryDocExists: z.boolean().optional(),
  orientationTrainingDate: z.string().optional().nullable().or(z.literal('')),
  ppeHandoverDocExists: z.boolean().optional(),
  // Sağlık/eğitim yapılandırılmış alanları (herhangi bir çalışan için geçerli, temp'e özel değil).
  ek2Suitable: z.boolean().optional(),
  ek2Date: z.string().optional().nullable().or(z.literal('')),
  // Eğitimi veren İSG uzmanı / muayene eden işyeri hekimi / DSP - artık serbest metin değil,
  // çalışanın firmasına (companyId) atanmış company_role_assignments kaydına referans (bkz.
  // company-roles.routes.js). '' boş seçenek anlamına gelir (temizler).
  isgSpecialistAssignmentId: z.string().optional().nullable().or(z.literal('')),
  physicianAssignmentId: z.string().optional().nullable().or(z.literal('')),
  dspAssignmentId: z.string().optional().nullable().or(z.literal('')),
  // Tetkik tarihi girildiyse opsiyonel olarak hangi tetkiklerin yapıldığı (sabit liste
  // frontend'de tanımlı - bkz. lib/employee.js MEDICAL_EXAM_TYPES).
  medicalExamTypes: z.array(z.string()).optional().nullable(),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (
      !hasPermission(req, 'uygunsuzluk_acma') &&
      !hasPermission(req, 'insan_kaynaklari_yonetimi') &&
      !hasPermission(req, 'gecici_gorevlendirme_yonetimi')
    ) {
      throw ApiError.forbidden();
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz çalışan bilgisi.', parsed.error.flatten());
    const projectId = resolveProjectId(req, parsed.data.projectId);
    const endDate = parsed.data.endDate || null;

    // Hedef firma geçici görevlendirme firması mı? Yalnızca 'gecici_gorevlendirme_yonetimi'
    // yetkisine sahip (ve 'uygunsuzluk_acma'/'insan_kaynaklari_yonetimi' OLMAYAN) kullanıcılar
    // yalnızca bu tür firmalara çalışan ekleyebilir; ayrıca bu tür ekleme admin dışındaki
    // kullanıcılar için admin onayına gider (bkz. TEMP_EMPLOYEE_CREATE executor).
    let targetCompany = null;
    if (parsed.data.companyId) {
      [targetCompany] = await db.select().from(companies).where(eq(companies.id, parsed.data.companyId)).limit(1);
    }
    const isTemp = !!targetCompany?.isTemporaryAssignment;
    const canManageAllEmployees = hasPermission(req, 'uygunsuzluk_acma') || hasPermission(req, 'insan_kaynaklari_yonetimi');
    if (!isTemp && !canManageAllEmployees) {
      throw ApiError.forbidden('Yalnızca geçici görevlendirme firmalarına çalışan ekleme yetkiniz var.');
    }

    // Aynı firmada ad soyad + (girildiyse) TC kimlik numarası aynı olan aktif bir çalışan
    // zaten varsa mükerrer kayıt oluşturulmasın, uyarı verilsin.
    if (parsed.data.companyId) {
      const dupConditions = [
        eq(employees.companyId, parsed.data.companyId),
        eq(employees.isActive, true),
        ilike(employees.fullName, parsed.data.fullName.trim()),
      ];
      if (parsed.data.nationalId) dupConditions.push(eq(employees.nationalId, parsed.data.nationalId));
      const duplicate = await db.select({ id: employees.id }).from(employees).where(and(...dupConditions)).limit(1);
      if (duplicate.length > 0) {
        throw ApiError.conflict(
          parsed.data.nationalId
            ? `"${parsed.data.fullName}" (${parsed.data.nationalId}) bu firmada zaten kayıtlı.`
            : `"${parsed.data.fullName}" adında bir çalışan bu firmada zaten kayıtlı. Farklı bir kişiyse TC kimlik numarasını da girin.`
        );
      }
    }

    await assertAssignmentBelongsToCompany(parsed.data.isgSpecialistAssignmentId || null, parsed.data.companyId || null, 'ISG_UZMANI', 'İş Güvenliği Uzmanı');
    await assertAssignmentBelongsToCompany(parsed.data.physicianAssignmentId || null, parsed.data.companyId || null, 'ISYERI_HEKIMI', 'İşyeri Hekimi');
    await assertAssignmentBelongsToCompany(parsed.data.dspAssignmentId || null, parsed.data.companyId || null, 'DIGER_SAGLIK_PERSONELI', 'Diğer Sağlık Personeli');

    const employeeData = {
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
      // Yalnızca geçmiş/bugünkü bir çıkış tarihi çalışanı hemen arşivler; gelecek tarihli bir
      // (görev) bitiş tarihi çalışanı aktif bırakır - bkz. isPastOrToday yorumu.
      isActive: !(endDate && isPastOrToday(endDate)),
      // İlk kayıt: "ilk giriş tarihi" burada bir kere sabitlenir. Zaten çıkışlı (endDate dolu ve
      // geçmiş/bugünkü) olarak ekleniyorsa (nadir - genelde geçmiş kayıt girişi) en son çıkış
      // tarihi de aynı anda set edilir.
      firstStartDate: toDateOrNull(parsed.data.startDate),
      lastExitDate: endDate && isPastOrToday(endDate) ? toDateOrNull(endDate) : null,
      assignmentFormExists: parsed.data.assignmentFormExists ?? false,
      sgkEntryDocExists: parsed.data.sgkEntryDocExists ?? false,
      orientationTrainingDate: toDateOrNull(parsed.data.orientationTrainingDate),
      ppeHandoverDocExists: parsed.data.ppeHandoverDocExists ?? false,
      ek2Suitable: parsed.data.ek2Suitable ?? false,
      ek2Date: toDateOrNull(parsed.data.ek2Date),
      isgSpecialistAssignmentId: parsed.data.isgSpecialistAssignmentId || null,
      physicianAssignmentId: parsed.data.physicianAssignmentId || null,
      dspAssignmentId: parsed.data.dspAssignmentId || null,
      medicalExamTypes: parsed.data.medicalExamTypes && parsed.data.medicalExamTypes.length > 0 ? parsed.data.medicalExamTypes : null,
    };

    if (isTemp) {
      await runOrQueueForApproval(req, res, {
        actionType: 'TEMP_EMPLOYEE_CREATE',
        entityType: 'employee',
        entityId: targetCompany.id,
        payload: { employeeData },
        summary: `"${employeeData.fullName}", "${targetCompany.name}" geçici görevlendirme firmasına çalışan olarak eklenecek.`,
        projectId,
        successStatus: 201,
      });
      return;
    }

    const [created] = await db.insert(employees).values(employeeData).returning();

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
  assignmentFormExists: z.boolean().optional(),
  sgkEntryDocExists: z.boolean().optional(),
  orientationTrainingDate: z.string().optional().nullable().or(z.literal('')),
  ppeHandoverDocExists: z.boolean().optional(),
  ek2Suitable: z.boolean().optional(),
  ek2Date: z.string().optional().nullable().or(z.literal('')),
  isgSpecialistAssignmentId: z.string().optional().nullable().or(z.literal('')),
  physicianAssignmentId: z.string().optional().nullable().or(z.literal('')),
  dspAssignmentId: z.string().optional().nullable().or(z.literal('')),
  medicalExamTypes: z.array(z.string()).optional().nullable(),
});

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (
      !hasPermission(req, 'uygunsuzluk_acma') &&
      !hasPermission(req, 'insan_kaynaklari_yonetimi') &&
      !hasPermission(req, 'gecici_gorevlendirme_yonetimi')
    ) {
      throw ApiError.forbidden();
    }
    const [employee] = await db.select().from(employees).where(eq(employees.id, req.params.id)).limit(1);
    if (!employee) throw ApiError.notFound('Çalışan bulunamadı.');

    if (
      !req.user.isSystemAdmin &&
      !hasPermission(req, 'uygunsuzluk_gorme') &&
      !hasPermission(req, 'insan_kaynaklari_yonetimi') &&
      !hasPermission(req, 'gecici_gorevlendirme_yonetimi')
    ) {
      const scoped = await getScopedCompanyIds(req.user.sub, employee.projectId);
      if (!scoped.includes(employee.companyId)) throw ApiError.forbidden();
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz çalışan bilgisi.', parsed.error.flatten());

    // Hedef firma (companyId değiştiriliyorsa yeni firma, değilse mevcut firma) geçici
    // görevlendirme firması mı? bkz. POST / rotasındaki aynı mantık.
    const effectiveCompanyId = parsed.data.companyId !== undefined ? parsed.data.companyId : employee.companyId;
    let targetCompany = null;
    if (effectiveCompanyId) {
      [targetCompany] = await db.select().from(companies).where(eq(companies.id, effectiveCompanyId)).limit(1);
    }
    const isTemp = !!targetCompany?.isTemporaryAssignment;
    const canManageAllEmployees = hasPermission(req, 'uygunsuzluk_acma') || hasPermission(req, 'insan_kaynaklari_yonetimi');
    if (!isTemp && !canManageAllEmployees) {
      throw ApiError.forbidden('Yalnızca geçici görevlendirme firmalarındaki çalışanları düzenleme yetkiniz var.');
    }

    const values = {};
    if (parsed.data.companyId !== undefined) values.companyId = parsed.data.companyId || null;
    if (parsed.data.fullName !== undefined) values.fullName = parsed.data.fullName;
    if (parsed.data.nationalId !== undefined) values.nationalId = parsed.data.nationalId || null;
    if (parsed.data.position !== undefined) values.position = parsed.data.position || null;
    if (parsed.data.isgTrainingDate !== undefined) values.isgTrainingDate = toDateOrNull(parsed.data.isgTrainingDate);
    if (parsed.data.isgTrainingExpiryDate !== undefined) {
      values.isgTrainingExpiryDate = toDateOrNull(parsed.data.isgTrainingExpiryDate);
      values.trainingExpiryReminderSentAt = null; // tarih değiştiyse süre dolum uyarısı yeniden hesaplanabilsin
    }
    if (parsed.data.medicalExamDate !== undefined) {
      values.medicalExamDate = toDateOrNull(parsed.data.medicalExamDate);
      values.medicalExamExpiryReminderSentAt = null;
    }
    if (parsed.data.startWorkTrainingNote !== undefined) values.startWorkTrainingNote = parsed.data.startWorkTrainingNote || null;
    if (parsed.data.ek2Note !== undefined) values.ek2Note = parsed.data.ek2Note || null;
    if (parsed.data.healthAuthoritySignatureNote !== undefined) values.healthAuthoritySignatureNote = parsed.data.healthAuthoritySignatureNote || null;
    if (parsed.data.isgRole !== undefined) values.isgRole = parsed.data.isgRole || null;
    if (parsed.data.mykCertificateNo !== undefined) values.mykCertificateNo = parsed.data.mykCertificateNo || null;
    if (parsed.data.mykCertificateDate !== undefined) values.mykCertificateDate = toDateOrNull(parsed.data.mykCertificateDate);
    if (parsed.data.startDate !== undefined) values.startDate = toDateOrNull(parsed.data.startDate);
    if (parsed.data.assignmentFormExists !== undefined) values.assignmentFormExists = parsed.data.assignmentFormExists;
    if (parsed.data.sgkEntryDocExists !== undefined) values.sgkEntryDocExists = parsed.data.sgkEntryDocExists;
    if (parsed.data.orientationTrainingDate !== undefined) values.orientationTrainingDate = toDateOrNull(parsed.data.orientationTrainingDate);
    if (parsed.data.ppeHandoverDocExists !== undefined) values.ppeHandoverDocExists = parsed.data.ppeHandoverDocExists;
    if (parsed.data.ek2Suitable !== undefined) values.ek2Suitable = parsed.data.ek2Suitable;
    if (parsed.data.ek2Date !== undefined) {
      values.ek2Date = toDateOrNull(parsed.data.ek2Date);
      values.ek2ExpiryReminderSentAt = null;
    }
    if (parsed.data.isgSpecialistAssignmentId !== undefined) {
      await assertAssignmentBelongsToCompany(parsed.data.isgSpecialistAssignmentId || null, effectiveCompanyId, 'ISG_UZMANI', 'İş Güvenliği Uzmanı');
      values.isgSpecialistAssignmentId = parsed.data.isgSpecialistAssignmentId || null;
    }
    if (parsed.data.physicianAssignmentId !== undefined) {
      await assertAssignmentBelongsToCompany(parsed.data.physicianAssignmentId || null, effectiveCompanyId, 'ISYERI_HEKIMI', 'İşyeri Hekimi');
      values.physicianAssignmentId = parsed.data.physicianAssignmentId || null;
    }
    if (parsed.data.dspAssignmentId !== undefined) {
      await assertAssignmentBelongsToCompany(parsed.data.dspAssignmentId || null, effectiveCompanyId, 'DIGER_SAGLIK_PERSONELI', 'Diğer Sağlık Personeli');
      values.dspAssignmentId = parsed.data.dspAssignmentId || null;
    }
    if (parsed.data.medicalExamTypes !== undefined) {
      values.medicalExamTypes = parsed.data.medicalExamTypes && parsed.data.medicalExamTypes.length > 0 ? parsed.data.medicalExamTypes : null;
    }
    if (parsed.data.endDate !== undefined) {
      const endDateRaw = parsed.data.endDate || null;
      // Yalnızca geçmiş/bugünkü bir çıkış tarihi çalışanı otomatik arşive alır; gelecek tarihli
      // bir (görev) bitiş tarihi girildiğinde çalışan hâlâ aktif kalır - o tarih gelince
      // scheduledJobs.service.js içindeki günlük kontrol otomatik arşivler (bkz. isPastOrToday).
      const endDateReached = endDateRaw && isPastOrToday(endDateRaw);
      values.isActive = !endDateReached;
      values.endDate = toDateOrNull(endDateRaw);
      // Bitiş tarihi değiştiyse (ör. görevlendirme uzatıldıysa) "bitiyor" uyarısı yeniden
      // tetiklenebilsin diye daha önce gönderilmiş işareti sıfırlanır.
      values.tempAssignmentEndingReminderSentAt = null;
      if (endDateReached) {
        // Arşivleniyor: en son çıkış tarihini kalıcı olarak sakla (bkz. schema.js employees.lastExitDate
        // yorumu) - bu değer, çalışan sonradan yeniden aktif edilip endDate temizlense bile kaybolmaz.
        values.lastExitDate = values.endDate;
      } else if (!endDateRaw && employee.isActive === false) {
        // Yeniden aktif ediliyor (daha önce arşivdeydi) - bu "yeniden giriş" anıdır. lastExitDate
        // bilinçli olarak DOKUNULMADAN bırakılır (geçmiş çıkış bilgisi kaybolmasın diye); startDate
        // zaten yukarıda (girildiyse) güncellenmiş olur ve "yeniden giriş tarihi" olarak gösterilir.
      }
    }
    // Güvenlik ağı: eski (bu özellikten önce oluşturulmuş, migration backfill'ini bir şekilde
    // kaçırmış) kayıtlarda firstStartDate hâlâ boşsa, ilk kez bir giriş tarihi belli olduğunda set edilir.
    if (!employee.firstStartDate) {
      const effectiveStartDate = values.startDate !== undefined ? values.startDate : employee.startDate;
      if (effectiveStartDate) values.firstStartDate = effectiveStartDate;
    }

    // Geçici görevlendirme firmasına bağlı bir çalışandaki değişiklik admin dışındaki
    // kullanıcılar için admin onayına gider (bkz. TEMP_EMPLOYEE_UPDATE executor); normal
    // firmalardaki çalışan güncellemeleri mevcut davranış gereği anında uygulanır.
    if (isTemp) {
      await runOrQueueForApproval(req, res, {
        actionType: 'TEMP_EMPLOYEE_UPDATE',
        entityType: 'employee',
        entityId: employee.id,
        payload: { employeeId: employee.id, values },
        summary: `"${employee.fullName}" (${targetCompany.name}) geçici görevlendirme çalışan kaydı güncellenecek.`,
        projectId: employee.projectId,
      });
      return;
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
  requirePermission(['insan_kaynaklari_yonetimi', 'gecici_gorevlendirme_yonetimi']),
  asyncHandler(async (req, res) => {
    const [employee] = await db.select().from(employees).where(eq(employees.id, req.params.id)).limit(1);
    if (!employee) throw ApiError.notFound('Çalışan bulunamadı.');

    if (!hasPermission(req, 'insan_kaynaklari_yonetimi')) {
      // Yalnızca 'gecici_gorevlendirme_yonetimi' yetkisi olanlar sadece geçici görevlendirme
      // firmalarındaki çalışanları silebilir.
      let targetCompany = null;
      if (employee.companyId) {
        [targetCompany] = await db.select().from(companies).where(eq(companies.id, employee.companyId)).limit(1);
      }
      if (!targetCompany?.isTemporaryAssignment) {
        throw ApiError.forbidden('Yalnızca geçici görevlendirme firmalarındaki çalışanları silme yetkiniz var.');
      }
    }

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
  requirePermission('insan_kaynaklari_yonetimi'),
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

    let company = null;
    if (employee.companyId) {
      [company] = await db.select().from(companies).where(eq(companies.id, employee.companyId)).limit(1);
    }
    const isTemp = !!company?.isTemporaryAssignment;

    if (!req.user.isSystemAdmin && !hasPermission(req, 'uygunsuzluk_gorme') && !hasPermission(req, 'gecici_gorevlendirme_yonetimi')) {
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

    // Çalışana bağlı İSG uzmanı/işyeri hekimi/DSP atama kayıtlarını (varsa) çözümleyip, kartta
    // tek istekle gösterilebilecek özet nesneler olarak ekle (bkz. assertAssignmentBelongsToCompany
    // yorumu - isgSpecialistAssignmentId vb. artık serbest metin değil company_role_assignments FK'i).
    const assignmentIds = [employee.isgSpecialistAssignmentId, employee.physicianAssignmentId, employee.dspAssignmentId].filter(Boolean);
    let assignmentById = new Map();
    if (assignmentIds.length > 0) {
      const assignmentRows = await db
        .select({
          id: companyRoleAssignments.id,
          source: companyRoleAssignments.source,
          employeeFullName: employees.fullName,
          outsideFullName: companyRoleAssignments.outsideFullName,
          outsideCompanyName: companyRoleAssignments.outsideCompanyName,
          certificateNo: companyRoleAssignments.certificateNo,
          certificateClass: companyRoleAssignments.certificateClass,
          certificateStartDate: companyRoleAssignments.certificateStartDate,
          certificateEndDate: companyRoleAssignments.certificateEndDate,
        })
        .from(companyRoleAssignments)
        .leftJoin(employees, eq(companyRoleAssignments.employeeId, employees.id))
        .where(inArray(companyRoleAssignments.id, assignmentIds));
      assignmentById = new Map(
        assignmentRows.map((a) => [
          a.id,
          { ...a, fullName: a.source === 'CALISAN' ? a.employeeFullName : a.outsideFullName },
        ])
      );
    }

    res.json({
      employee: {
        ...employee,
        isgSpecialistAssignment: employee.isgSpecialistAssignmentId ? assignmentById.get(employee.isgSpecialistAssignmentId) || null : null,
        physicianAssignment: employee.physicianAssignmentId ? assignmentById.get(employee.physicianAssignmentId) || null : null,
        dspAssignment: employee.dspAssignmentId ? assignmentById.get(employee.dspAssignmentId) || null : null,
      },
      nonconformities: rows,
      company: company ? { id: company.id, name: company.name, isTemporaryAssignment: isTemp } : null,
    });
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
  medicalExamTypes: z.array(z.string()).optional().nullable(),
  ek2Date: z.string().optional().nullable(),
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
  requirePermission('insan_kaynaklari_yonetimi'),
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
    let rejoined = 0;
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
          medicalExamTypes: row.medicalExamTypes && row.medicalExamTypes.length > 0 ? row.medicalExamTypes : null,
          ek2Date: toDateOrNull(row.ek2Date),
          startWorkTrainingNote: (row.startWorkTrainingNote || '').trim() || null,
          ek2Note: (row.ek2Note || '').trim() || null,
          healthAuthoritySignatureNote: (row.healthAuthoritySignatureNote || '').trim() || null,
          isgRole: (row.isgRole || '').trim() || null,
          startDate: toDateOrNull(startDate),
        };

        if (existingRow) {
          // Bu kişi daha önce (bu firmada) arşivdeyse, yeni listede tekrar görünmesi "yeniden
          // giriş" anlamına gelir: aktif edilir, mevcut çıkış tarihi temizlenir - ama en son
          // çıkış tarihi (lastExitDate) BİLİNÇLİ OLARAK values'a dahil edilmez, DB'deki değeri
          // korunur (bkz. schema.js employees.lastExitDate yorumu / Kullanım Kılavuzu).
          const wasInactive = existingRow.isActive === false;
          if (wasInactive) {
            values.isActive = true;
            values.endDate = null;
            rejoined += 1;
          }
          if (!existingRow.firstStartDate && values.startDate) {
            values.firstStartDate = values.startDate;
          }
          await db.update(employees).set(values).where(eq(employees.id, existingRow.id));
          updated += 1;
          const merged = { ...existingRow, ...values };
          byNationalId.set(nationalId, merged);
          byName.set(fullName.toLowerCase(), merged);
        } else {
          const [createdRow] = await db
            .insert(employees)
            .values({ projectId, companyId, isActive: true, firstStartDate: values.startDate, lastExitDate: null, ...values })
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
        // Yeni listede artık görünmüyor - tarihsiz (belirsiz) olarak arşive alınır; en son çıkış
        // tarihi de bilinmediği için null'a çekilir (bkz. Kullanım Kılavuzu Çalışanlar bölümü:
        // admin/İK bu çalışanlar için Çalışanlar > Arşiv sekmesinden gerçek çıkış tarihini girmeli).
        await db.update(employees).set({ isActive: false, endDate: null, lastExitDate: null }).where(eq(employees.id, emp.id));
        archived += 1;
      }
    }

    await logAudit({
      userId: req.user.sub,
      action: 'EMPLOYEE_IMPORT',
      entityType: 'employee',
      entityId: companyId,
      details: { projectId, companyId, created, updated, archived, rejoined, skipped },
      ipAddress: req.ip,
    });

    res.json({
      created,
      updated,
      archived,
      rejoined,
      skipped,
      errors,
      // Frontend'de belirgin bir uyarı göstermek için: içe aktarma sonrası tarihsiz arşivlenen
      // kişi varsa admin/İK gerçek çıkış tarihlerini elle girmeye teşvik edilmeli.
      needsExitDateReview: archived > 0,
    });
  })
);

module.exports = router;
